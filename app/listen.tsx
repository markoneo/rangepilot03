import { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { C, F } from '@/constants/theme';

/**
 * Listen-only test (web Bluetooth). The adapter is put in monitor mode and
 * only LISTENS to what the car's units broadcast. No request is ever sent to
 * the car: every command here is an "AT" setting for the adapter itself.
 */

const SERVICES: (number | string)[] = [
  0x18f0,
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  0xfff0,
  0xffe0,
  0xffe5,
  0xae30,
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Seen = { count: number; samples: string[] };

export default function ListenScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [copied, setCopied] = useState(false);
  const io = useRef<{ write: any; buffer: string; stop: boolean } | null>(null);
  const logRef = useRef<string[]>([]);
  const log = (t: string) => {
    logRef.current = [...logRef.current, t];
    setLines(logRef.current);
  };
  const supported = Platform.OS === 'web' && typeof navigator !== 'undefined' && !!(navigator as any).bluetooth;

  const send = async (text: string) => {
    const link = io.current!;
    const data = new TextEncoder().encode(text);
    if (link.write.properties.writeWithoutResponse) await link.write.writeValueWithoutResponse(data);
    else await link.write.writeValue(data);
  };
  /** An adapter setting ("AT…"): wait for the adapter's prompt. Only AT commands are allowed. */
  const at = async (c: string, timeoutMs = 4000): Promise<string> => {
    if (!/^AT/.test(c)) throw new Error('Only adapter settings may be sent here');
    io.current!.buffer = '';
    await send(c + '\r');
    const start = Date.now();
    while (!io.current!.buffer.includes('>') && Date.now() - start < timeoutMs) await sleep(15);
    const a = io.current!.buffer.replace(/>/g, '').replace(/\r+/g, ' | ').replace(/^[ |]+|[ |]+$/g, '').trim();
    log(`${c} → ${a || '(empty)'}`);
    return a;
  };
  /** Listen for a while, then stop monitoring. Returns the raw lines heard. */
  const listen = async (ms: number): Promise<string[]> => {
    io.current!.buffer = '';
    await send('ATMA\r');
    await sleep(ms);
    await send('\r'); // any character stops monitoring
    const start = Date.now();
    while (!io.current!.buffer.includes('>') && Date.now() - start < 2500) await sleep(15);
    return io.current!.buffer.split(/[\r>]+/).map((l) => l.trim()).filter(Boolean);
  };
  const collect = (raw: string[], into: Map<string, Seen>) => {
    let frames = 0;
    for (const l of raw) {
      const m = l.match(/^([0-9A-F]{3})([0-9A-F]{2,16})$/);
      if (!m) continue;
      frames++;
      const e = into.get(m[1]) ?? { count: 0, samples: [] };
      e.count++;
      if (e.samples.length < 8 && !e.samples.includes(m[2])) e.samples.push(m[2]);
      into.set(m[1], e);
    }
    return frames;
  };

  const connect = async () => {
    setBusy(true);
    try {
      const device = await (navigator as any).bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
      log(`Adapter: ${device.name ?? 'unnamed'}`);
      const server = await device.gatt.connect();
      let notify: any = null;
      let write: any = null;
      for (const id of SERVICES) {
        let service: any;
        try {
          service = await server.getPrimaryService(id);
        } catch {
          continue;
        }
        const chars = await service.getCharacteristics();
        notify = chars.find((ch: any) => ch.properties.notify || ch.properties.indicate);
        write = chars.find((ch: any) => ch.properties.write || ch.properties.writeWithoutResponse);
        if (notify && write) break;
      }
      if (!notify || !write) {
        log('No serial service found on this adapter.');
        return;
      }
      io.current = { write, buffer: '', stop: false };
      notify.addEventListener('characteristicvaluechanged', (e: any) => {
        if (io.current) io.current.buffer += new TextDecoder().decode(e.target.value);
      });
      await notify.startNotifications();
      device.addEventListener('gattserverdisconnected', () => {
        setConnected(false);
        log('— adapter disconnected —');
      });
      await at('ATZ', 8000);
      await at('ATE0');
      await at('ATL0');
      await at('ATS0');
      await at('ATH1');
      await at('ATCAF0');
      await at('ATSP6');
      await at('ATCSM1'); // silent: the adapter does not even acknowledge frames
      setConnected(true);
      log('Connected. Tap “Listen”.');
    } catch (e: any) {
      log(`Connect failed: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true);
    io.current!.stop = false;
    try {
      // 1) everything, in short bursts (a busy network overflows the adapter quickly)
      const all = new Map<string, Seen>();
      let frames = 0;
      let overflow = 0;
      for (let i = 0; i < 8 && !io.current!.stop; i++) {
        const raw = await listen(1200);
        // show exactly what the adapter returned, so silence can be told apart from a format we don't parse
        if (i < 2) log(`raw ${i + 1}: ${raw.length} lines${raw.length ? ' · ' + raw.slice(0, 6).join(' | ') : ''}`);
        if (raw.some((l) => l.includes('BUFFER FULL'))) overflow++;
        frames += collect(raw, all);
      }
      log(`Heard ${frames} frames from ${all.size} senders (adapter overflowed ${overflow}×).`);
      if (all.size === 0) {
        log('Nothing is visible on this port without asking: the car keeps its internal traffic behind a gateway.');
        return;
      }
      // 2) each sender on its own, so nothing is lost
      const ids = [...all.keys()].sort();
      log(`Senders: ${ids.join(' ')}`);
      for (const id of ids) {
        if (io.current!.stop) break;
        io.current!.buffer = '';
        await send(`ATCRA${id}\r`);
        await sleep(150);
        const one = new Map<string, Seen>();
        const n = collect(await listen(1500), one);
        const e = one.get(id);
        log(`${id} · ${n} in 1.5 s · ${(e?.samples ?? all.get(id)!.samples).join(' ')}`);
      }
      await at('ATAR');
      log(io.current!.stop ? 'Stopped.' : 'Finished. Copy the log and send it to me.');
    } catch (e: any) {
      log(`Stopped: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await (navigator as any).clipboard.writeText(logRef.current.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      log('Could not copy — select the text and copy it by hand.');
    }
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={10}>
          <ArrowLeft size={22} color={C.textDim} />
        </TouchableOpacity>
        <Text style={s.title}>Listen test</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: insets.bottom + 40 }}>
        {!supported ? (
          <Text style={s.body}>This browser has no Bluetooth access. Use Chrome on Android.</Text>
        ) : (
          <>
            <Text style={s.body}>
              Listens only: nothing is asked of the car. Car switched on and parked, charger unplugged, other OBD apps
              closed. Takes about a minute.
            </Text>
            <TouchableOpacity style={[s.btn, (busy || connected) && s.off]} onPress={connect} disabled={busy || connected} activeOpacity={0.85}>
              <Text style={s.btnText}>{connected ? 'Adapter connected' : '1 · Connect adapter'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, (busy || !connected) && s.off]} onPress={run} disabled={busy || !connected} activeOpacity={0.85}>
              <Text style={s.btnText}>{busy && connected ? 'Listening…' : '2 · Listen'}</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={[s.ghost, { flex: 1 }]} onPress={() => io.current && (io.current.stop = true)} activeOpacity={0.85}>
                <Text style={s.ghostText}>Stop</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.ghost, { flex: 1 }]} onPress={copy} activeOpacity={0.85}>
                <Text style={s.ghostText}>{copied ? 'Copied' : 'Copy log'}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
        <View style={s.log}>
          {lines.length === 0 ? (
            <Text style={s.logLine}>The log appears here.</Text>
          ) : (
            lines.map((l, i) => (
              <Text key={i} style={s.logLine} selectable>
                {l}
              </Text>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 22, paddingVertical: 12 },
  title: { fontSize: 22, fontFamily: F.displayBold, color: C.text, letterSpacing: -0.5 },
  body: { fontSize: 14, lineHeight: 20, fontFamily: F.regular, color: C.textDim },
  btn: { height: 56, borderRadius: 18, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  btnText: { fontSize: 16, fontFamily: F.bold, color: C.onAccent },
  off: { opacity: 0.4 },
  ghost: { height: 48, borderRadius: 16, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  ghostText: { fontSize: 15, fontFamily: F.semibold, color: C.text },
  log: { backgroundColor: C.card, borderRadius: 16, padding: 14, marginTop: 14 },
  logLine: { fontSize: 12, lineHeight: 18, color: C.textDim, fontFamily: Platform.OS === 'web' ? ('ui-monospace, Menlo, monospace' as any) : F.regular },
});
