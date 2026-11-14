import { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { C, F } from '@/constants/theme';

/**
 * OBD test page (web only, needs Web Bluetooth: Chrome on Android, or the
 * Bluefy browser on iPhone). Connects to a Bluetooth LE ELM327 adapter and
 * only READS: standard OBD PIDs and UDS "read data by identifier" (0x22).
 * Nothing is ever written to the car.
 */

// Serial-over-BLE services used by common ELM327 adapters (Vgate first)
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
const hex = (n: number, len = 2) => n.toString(16).toUpperCase().padStart(len, '0');

export default function ObdScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [soc, setSoc] = useState<string | null>(null);
  const [ecus, setEcus] = useState<string[]>([]);
  const [scanEcu, setScanEcu] = useState('');
  const [scanFrom, setScanFrom] = useState('0100');
  const [scanTo, setScanTo] = useState('01FF');
  const [copied, setCopied] = useState(false);

  const io = useRef<{ write: any; buffer: string; stop: boolean; device: any } | null>(null);
  const logRef = useRef<string[]>([]);
  const log = (text: string) => {
    logRef.current = [...logRef.current, text];
    setLines(logRef.current);
  };

  const supported = Platform.OS === 'web' && typeof navigator !== 'undefined' && !!(navigator as any).bluetooth;

  /** Send one command and wait for the adapter's ">" prompt */
  const cmd = async (c: string, timeoutMs = 6000): Promise<string> => {
    const link = io.current;
    if (!link) throw new Error('Not connected');
    link.buffer = '';
    const data = new TextEncoder().encode(c + '\r');
    if (link.write.writeValueWithoutResponse && link.write.properties.writeWithoutResponse) {
      await link.write.writeValueWithoutResponse(data);
    } else {
      await link.write.writeValue(data);
    }
    const start = Date.now();
    while (!link.buffer.includes('>') && Date.now() - start < timeoutMs) await sleep(15);
    const answer = link.buffer.replace(/>/g, '').replace(/\r+/g, ' | ').replace(/^[ |]+|[ |]+$/g, '').trim();
    return link.buffer.includes('>') ? answer : `${answer} (timeout)`;
  };
  const run = async (c: string, timeoutMs?: number) => {
    const a = await cmd(c, timeoutMs);
    log(`${c} → ${a || '(empty)'}`);
    return a;
  };

  const connect = async () => {
    setBusy(true);
    try {
      const bt = (navigator as any).bluetooth;
      const device = await bt.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
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
        log(
          `Service ${typeof id === 'number' ? hex(id, 4) : id}: ` +
            chars
              .map(
                (ch: any) =>
                  `${ch.uuid.slice(4, 8)}[${ch.properties.notify ? 'n' : ''}${ch.properties.indicate ? 'i' : ''}${
                    ch.properties.write ? 'w' : ''
                  }${ch.properties.writeWithoutResponse ? 'W' : ''}]`
              )
              .join(' ')
        );
        notify = notify ?? chars.find((ch: any) => ch.properties.notify || ch.properties.indicate);
        write = write ?? chars.find((ch: any) => ch.properties.write || ch.properties.writeWithoutResponse);
        if (notify && write) break;
      }
      if (!notify || !write) {
        log('No serial service found on this adapter. Send me this log.');
        return;
      }
      io.current = { write, buffer: '', stop: false, device };
      notify.addEventListener('characteristicvaluechanged', (e: any) => {
        if (io.current) io.current.buffer += new TextDecoder().decode(e.target.value);
      });
      await notify.startNotifications();
      device.addEventListener('gattserverdisconnected', () => {
        setConnected(false);
        log('— adapter disconnected —');
      });

      await run('ATZ', 8000);
      await run('ATE0');
      await run('ATL0');
      await run('ATS0');
      await run('ATH1');
      await run('ATAT1');
      await run('ATSP6');
      await run('ATRV');
      setConnected(true);
      log('Connected. Tap “Read car”.');
    } catch (e: any) {
      log(`Connect failed: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  /** Standard OBD-II: supported PIDs, then every supported PID once */
  const readStandard = async () => {
    const found: number[] = [];
    await run('ATSP6');
    await run('ATSH7DF');
    for (const base of [0x00, 0x20, 0x40, 0x60, 0x80, 0xa0, 0xc0]) {
      const a = await run(`01${hex(base)}`, base === 0 ? 12000 : 6000);
      // any ECU's bitmap: "41 XX b1 b2 b3 b4" (spaces off)
      const m = a.match(new RegExp(`41${hex(base)}([0-9A-F]{8})`));
      if (!m) break;
      const bits = parseInt(m[1], 16);
      for (let i = 0; i < 32; i++) if ((bits >>> (31 - i)) & 1) found.push(base + i + 1);
      if (!(bits & 1)) break;
    }
    await run('ATDPN');
    if (found.length === 0) {
      log('No standard OBD PIDs answered.');
      return;
    }
    log(`Supported PIDs: ${found.map((p) => hex(p)).join(' ')}`);
    for (const pid of found) {
      if (pid % 0x20 === 0) continue;
      const a = await run(`01${hex(pid)}`);
      if (pid === 0x5b) {
        const m = a.match(/415B([0-9A-F]{2})/);
        if (m) {
          const pct = (parseInt(m[1], 16) * 100) / 255;
          setSoc(`${pct.toFixed(1)}%`);
          log(`>>> Battery (PID 5B): ${pct.toFixed(1)}%`);
        }
      }
    }
  };

  /** Which control units answer a harmless "tester present" */
  const discover = async () => {
    const ids = new Set<string>();
    for (const [proto, header, label] of [
      ['6', '7DF', '11-bit'],
      ['7', '18DB33F1', '29-bit'],
    ] as const) {
      await run(`ATSP${proto}`);
      await run(`ATSH${header}`);
      for (const req of ['3E00', '1001']) {
        const a = await run(req, 8000);
        for (const part of a.split('|')) {
          const t = part.trim();
          const m = label === '11-bit' ? t.match(/^(7[0-9A-F]{2})/) : t.match(/^(18DAF1[0-9A-F]{2})/);
          if (m) ids.add(`${label}:${m[1]}`);
        }
      }
    }
    const list = [...ids];
    setEcus(list);
    if (list.length && !scanEcu) setScanEcu(list[0]);
    log(list.length ? `Control units answering: ${list.join(', ')}` : 'No control unit answered the UDS check.');
    await run('ATSP6');
    await run('ATSH7DF');
  };

  const readCar = async () => {
    setBusy(true);
    setSoc(null);
    try {
      log('— standard OBD —');
      await readStandard();
      log('— control units —');
      await discover();
      log('Done. Tap “Copy log” and send it to me.');
    } catch (e: any) {
      log(`Stopped: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  /** Read-only sweep of data identifiers on one control unit; logs only real answers */
  const scan = async () => {
    const [kind, id] = scanEcu.split(':');
    const from = parseInt(scanFrom, 16);
    const to = parseInt(scanTo, 16);
    if (!id || isNaN(from) || isNaN(to) || to < from) {
      log('Scan: pick a control unit and a valid range first.');
      return;
    }
    setBusy(true);
    io.current!.stop = false;
    try {
      let tx: string;
      if (kind === '11-bit') {
        // answer on 7E8 means request on 7E0, etc.
        tx = hex(parseInt(id, 16) - 8, 3);
        await run('ATSP6');
      } else {
        tx = `18DA${id.slice(6, 8)}F1`;
        await run('ATSP7');
      }
      await run(`ATSH${tx}`);
      await run('ATFCSH' + tx);
      await run('ATFCSD300000');
      await run('ATFCSM1');
      log(`— scan ${id} ${hex(from, 4)}–${hex(to, 4)} —`);
      let hits = 0;
      for (let did = from; did <= to; did++) {
        if (io.current?.stop) {
          log('Scan stopped.');
          break;
        }
        const a = await cmd(`22${hex(did, 4)}`, 2500);
        if (a.includes(`62${hex(did, 4)}`)) {
          hits++;
          log(`22${hex(did, 4)} → ${a}`);
        }
        if ((did - from) % 32 === 31) log(`… ${hex(did, 4)} (${hits} found)`);
      }
      log(`Scan finished: ${hits} identifiers answered. Copy the log and send it to me.`);
      await run('ATFCSM0');
      await run('ATSH7DF');
    } catch (e: any) {
      log(`Scan stopped: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Automatic search on every control unit, read-only:
   * 1) ask what the unit is, 2) sample each block of identifiers to see where
   * data lives, 3) read the blocks that answered in full.
   */
  const scanAll = async () => {
    setBusy(true);
    io.current!.stop = false;
    const stopped = () => !!io.current?.stop;
    try {
      await run('ATSP6');
      await run('ATAT2');
      await run('ATFCSD300000');
      for (const ecu of ecus) {
        if (stopped()) break;
        const id = ecu.split(':')[1];
        const tx = hex(parseInt(id, 16) - 8, 3);
        log(`=== ${id} ===`);
        await run(`ATSH${tx}`);
        await run(`ATFCSH${tx}`);
        await run('ATFCSM1');
        // what is this unit? (system name, part numbers — not the VIN)
        for (const did of ['F197', 'F187', 'F18A', 'F193', 'F195']) await run(`22${did}`, 3000);

        // sample every block xx00–xxFF
        const blocks: number[] = [];
        const neg: Record<string, number> = {};
        let silent = 0;
        for (let hi = 0; hi <= 0xff && !stopped(); hi++) {
          let hit = false;
          for (const lo of [0x00, 0x01, 0x02, 0x10]) {
            const did = hex((hi << 8) | lo, 4);
            const a = await cmd(`22${did}`, 2000);
            if (a.includes(`62${did}`)) {
              hit = true;
              log(`22${did} → ${a}`);
            } else {
              const m = a.match(/7F22([0-9A-F]{2})/);
              if (m) neg[m[1]] = (neg[m[1]] ?? 0) + 1;
              else silent++;
            }
          }
          if (hit) blocks.push(hi);
          if (hi % 64 === 63) log(`… sampled to ${hex(hi)}xx — blocks with data: ${blocks.map((b) => hex(b)).join(' ') || 'none'}`);
        }
        log(
          `${id}: refusals ${Object.entries(neg).map(([k, v]) => `${k}×${v}`).join(' ') || 'none'}, no answer ×${silent}`
        );

        // read the blocks that answered in full
        for (const hi of blocks) {
          if (stopped()) break;
          log(`— ${id} block ${hex(hi)}00–${hex(hi)}FF —`);
          for (let lo = 0; lo <= 0xff && !stopped(); lo++) {
            const did = hex((hi << 8) | lo, 4);
            const a = await cmd(`22${did}`, 2500);
            if (a.includes(`62${did}`)) log(`22${did} → ${a}`);
          }
        }
      }
      log(stopped() ? 'Search stopped.' : 'Search finished. Copy the log and send it to me.');
      await run('ATFCSM0');
      await run('ATAT1');
      await run('ATSH7DF');
    } catch (e: any) {
      log(`Search stopped: ${e?.message ?? e}`);
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
        <Text style={s.title}>OBD test</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: insets.bottom + 40 }}>
        {!supported ? (
          <Text style={s.body}>
            This browser has no Bluetooth access. On iPhone, open this page in the free “Bluefy” browser; on Android, use
            Chrome.
          </Text>
        ) : (
          <>
            <Text style={s.body}>
              Read-only test. Car switched on, parked, adapter plugged in. Close any other OBD app first — the adapter
              talks to one app at a time.
            </Text>

            {soc && (
              <View style={s.result}>
                <Text style={s.resultLabel}>Battery from the car</Text>
                <Text style={s.resultValue}>{soc}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[s.btn, (busy || connected) && s.off]}
              onPress={connect}
              disabled={busy || connected}
              activeOpacity={0.85}
            >
              <Text style={s.btnText}>{connected ? 'Adapter connected' : '1 · Connect adapter'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.btn, (busy || !connected) && s.off]}
              onPress={readCar}
              disabled={busy || !connected}
              activeOpacity={0.85}
            >
              <Text style={s.btnText}>{busy && connected ? 'Working…' : '2 · Read car'}</Text>
            </TouchableOpacity>

            {connected && ecus.length > 0 && (
              <>
                <TouchableOpacity
                  style={[s.btn, busy && s.off]}
                  onPress={scanAll}
                  disabled={busy}
                  activeOpacity={0.85}
                >
                  <Text style={s.btnText}>3 · Search all units (about 10 min)</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.copy}
                  onPress={() => {
                    if (io.current) io.current.stop = true;
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={s.copyText}>Stop search</Text>
                </TouchableOpacity>
              <View style={s.scanBox}>
                <Text style={s.label}>Manual scan of one unit</Text>
                <View style={s.ecuRow}>
                  {ecus.map((e) => (
                    <TouchableOpacity
                      key={e}
                      style={[s.ecu, scanEcu === e && s.ecuOn]}
                      onPress={() => setScanEcu(e)}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.ecuText, scanEcu === e && { color: C.onAccent }]}>{e.split(':')[1]}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={s.rangeRow}>
                  <TextInput style={s.input} value={scanFrom} onChangeText={setScanFrom} autoCapitalize="characters" maxLength={4} />
                  <Text style={s.body}>to</Text>
                  <TextInput style={s.input} value={scanTo} onChangeText={setScanTo} autoCapitalize="characters" maxLength={4} />
                  <TouchableOpacity
                    style={[s.small, busy && s.off]}
                    onPress={scan}
                    disabled={busy}
                    activeOpacity={0.85}
                  >
                    <Text style={s.smallText}>Scan</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.smallGhost}
                    onPress={() => {
                      if (io.current) io.current.stop = true;
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={s.smallGhostText}>Stop</Text>
                  </TouchableOpacity>
                </View>
              </View>
              </>
            )}

            <TouchableOpacity style={s.copy} onPress={copy} activeOpacity={0.85}>
              <Text style={s.copyText}>{copied ? 'Copied' : 'Copy log'}</Text>
            </TouchableOpacity>
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
  label: { fontSize: 12, fontFamily: F.semibold, color: C.textDim, letterSpacing: 1, textTransform: 'uppercase' },
  result: { backgroundColor: C.greenDim, borderRadius: 20, padding: 18, marginTop: 16 },
  resultLabel: { fontSize: 13, fontFamily: F.semibold, color: C.textDim },
  resultValue: { fontSize: 56, fontFamily: F.display, color: C.green, letterSpacing: -2 },
  btn: { height: 56, borderRadius: 18, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  btnText: { fontSize: 16, fontFamily: F.bold, color: C.onAccent },
  off: { opacity: 0.4 },
  scanBox: { backgroundColor: C.card, borderRadius: 20, padding: 16, marginTop: 14, gap: 10 },
  ecuRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ecu: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: C.cardHi },
  ecuOn: { backgroundColor: C.blue },
  ecuText: { fontSize: 13, fontFamily: F.semibold, color: C.textDim },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    width: 70,
    height: 42,
    borderRadius: 12,
    backgroundColor: C.bg,
    color: C.text,
    fontFamily: F.semibold,
    fontSize: 15,
    textAlign: 'center',
  },
  small: { height: 42, paddingHorizontal: 16, borderRadius: 12, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center' },
  smallText: { fontSize: 14, fontFamily: F.bold, color: C.onAccent },
  smallGhost: { height: 42, paddingHorizontal: 12, borderRadius: 12, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center' },
  smallGhostText: { fontSize: 14, fontFamily: F.semibold, color: C.text },
  copy: { height: 48, borderRadius: 16, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  copyText: { fontSize: 15, fontFamily: F.semibold, color: C.text },
  log: { backgroundColor: C.card, borderRadius: 16, padding: 14, marginTop: 14 },
  logLine: { fontSize: 12, lineHeight: 18, color: C.textDim, fontFamily: Platform.OS === 'web' ? ('ui-monospace, Menlo, monospace' as any) : F.regular },
});
