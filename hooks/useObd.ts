import { useEffect, useState } from 'react';
import { getObd, obdEnabled, obdSupported, resumeObd, subscribeObd, type ObdState } from '@/utils/obd';

/** Live OBD state for a screen, plus whether this user has set OBD up. */
export function useObd(): { obd: ObdState; supported: boolean; enabled: boolean; live: boolean } {
  const [obd, setObd] = useState<ObdState>(getObd());
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const refresh = () => {
      setObd(getObd());
      obdEnabled().then(setEnabled).catch(() => {});
    };
    refresh();
    resumeObd().catch(() => {});
    return subscribeObd(refresh);
  }, []);
  return { obd, supported: obdSupported(), enabled, live: obd.status === 'connected' && obd.soc != null };
}
