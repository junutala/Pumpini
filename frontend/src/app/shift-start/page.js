'use client';
// Start Shift — TWO screens, not three (owner, 01-Aug-2026).
//
//   1. GAUGE & OPENING DIP — photograph the gauge screen, the dip figures fill in
//      (visible and editable), save them.
//   2. ATTENDANT ASSIGNMENT — photo of the attendant, pick him, tick his nozzles,
//      ONE Start button. Come back to the same screen for the next attendant until
//      every nozzle is manned.
//
// The old separate "Open the shift" step is gone. It asked the manager to fill a
// form that the app can work out for itself: the slot follows the clock and the
// date is today, so both are shown inline on screen 1 and the shift row is created
// LAZILY — on the first dip save or on Next. Visiting the page creates nothing,
// which is what kept littering the table with empty shifts that then had to be
// deleted by hand.
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/navigation';
import { Check, ChevronRight, ArrowLeft, Droplets, X, ScanLine, AlertTriangle } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import PhotoCapture from '../../components/shared/PhotoCapture';
import ArtifactImage from '../../components/shared/ArtifactImage';
import api, { parseGaugeScreen, recordDipstick } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { markToTrueDip, dipToVolume } from '../../lib/calibration';

const inp = { width:'100%', padding:'9px 11px', border:'1.5px solid #e5e3de', borderRadius:8, fontSize:14, outline:'none', boxSizing:'border-box', background:'#fff' };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone:'Asia/Kolkata' });
const fmtL = n => Number(n||0).toFixed(2);
const STEPS = ['Gauge', 'Attendants'];

// India reads DD/MM and the outlet clock is IST — never the browser's locale, which
// on a laptop bought abroad would print MM/DD against a money record.
const fmtWhen = (ts) => new Date(ts).toLocaleString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:true });
const fmtClock = (ts) => new Date(ts).toLocaleTimeString('en-IN', { timeZone:'Asia/Kolkata', hour:'2-digit', minute:'2-digit', hour12:true });
const fmtDay = (d) => new Date(`${String(d).slice(0,10)}T00:00:00`).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });

const readB64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('Could not read image'));
  r.readAsDataURL(file);
});

// Which slot is running right now, per the outlet's own shift_definitions. The
// night slot wraps past midnight (22:00–06:00), so a plain range test is wrong for
// it — hence the two-armed comparison. HH:MM strings compare correctly as text.
const nowHHMM = () => new Date().toLocaleTimeString('en-GB', { timeZone:'Asia/Kolkata', hour:'2-digit', minute:'2-digit' });
const slotForNow = (defs) => {
  const now = nowHHMM();
  const hit = (defs||[]).find(d => {
    const s = String(d.start_time||'').slice(0,5), e = String(d.end_time||'').slice(0,5);
    if (!s || !e) return false;
    return s <= e ? (now >= s && now < e) : (now >= s || now < e);
  });
  return hit ? hit.shift_number : 1;
};

export default function ShiftStartPage() {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const router = useRouter();
  // Set when the Shifts screen sends us at a named shift (see the resume block below).
  // Read off window.location rather than useSearchParams(): on a statically routed
  // page Next 14 demands a Suspense boundary around that hook and fails the BUILD
  // without one. This is a client component that only reads the value inside an
  // effect, so there is nothing to gain from the hook and a deployment to lose.
  const wantShift = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('shift') : null;
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;

  const [step, setStep]       = useState(0);
  const [defs, setDefs]       = useState([]);
  const [users, setUsers]     = useState([]);
  const [shift, setShift]     = useState(null);
  const [attendants, setAttendants] = useState([]);
  const [nozzles, setNozzles] = useState([]);
  const [openShifts, setOpenShifts] = useState([]);
  const [slot, setSlot]       = useState({ shift_number:1, date: today() });
  const [resumed, setResumed] = useState(false);   // header tells the manager we picked up an existing shift
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');
  const [prices, setPrices]   = useState([]);   // current selling price per fuel — parallel-run reminder

  // Screen 1 — gauge & dip
  const [tanks, setTanks]     = useState([]);
  const [dips, setDips]       = useState({});       // tank_id -> entered mark-ordinal
  const [dipVol, setDipVol]   = useState({});       // tank_id -> manual volume (no-chart fallback)
  const [savedDips, setSavedDips] = useState({});   // tank_id -> true
  // tank_id -> the opening dip row the server carried from the last close. Present
  // means the manager has nothing to do for that tank (owner rule, 01-Aug: the
  // close IS the next open, so there can be no gap between two shifts to hide a
  // loss in). Absent means no prior close exists and a reading is genuinely needed.
  const [carriedDips, setCarriedDips] = useState({});
  const [dipArtifact, setDipArtifact] = useState({});  // tank_id -> gauge photo it was read off
  const [dipWarn, setDipWarn] = useState(null);     // [tank numbers] with no opening reading at all

  // The manager touching the slot picker must win over the clock-derived default,
  // which otherwise re-asserts itself the moment defs/openShifts arrive.
  const slotTouched = useRef(false);
  // Holds the in-flight (or settled) create so a double-tap on Next cannot open two
  // shifts for the same slot — React state alone is too slow to guard that.
  const shiftRef = useRef(null);

  // ── Gauge-screen scan (ATG / Pinelabs console photo) ──────────────────
  // Fills the LITRES box only, never the dip. That is deliberate: persistDip below
  // treats "dip entered" as a physical check and "litres only" as a system (ATG)
  // reading, keeping dip_cm null — which is exactly what a console reading is. So
  // the scan slots into the existing distinction instead of blurring it, and no
  // mm→cm conversion is needed on this screen at all.
  // Nothing is saved by scanning — Next commits whatever is on screen (flushDips),
  // so the manager reviews the filled figures and moves on. There is no per-tank
  // Save button any more; one photo fills every tank and one button commits them.
  const [gaugeBusy, setGaugeBusy] = useState(false);
  const [gaugeMsg,  setGaugeMsg]  = useState('');

  const handleGaugeScan = async (file) => {
    if (!file) return;
    setGaugeBusy(true); setGaugeMsg(''); setErr('');
    try {
      // The screen photo is filed against the shift, so create it first if this is
      // the manager's opening move. A failure here must not lose the photograph, so
      // the scan still runs unfiled rather than aborting.
      let shiftId = shift?.id || null;
      try { shiftId = (await ensureShift()).id; } catch { /* file it later; read the screen now */ }

      const img = new Image(); const url = URL.createObjectURL(file);
      const { base64, media_type } = await new Promise((resolve, reject) => {
        img.onload = () => {
          const max = 2600, scale = Math.min(1, max / Math.max(img.width, img.height));
          const cw = Math.round(img.width*scale), ch = Math.round(img.height*scale);
          const c = document.createElement('canvas'); c.width = cw; c.height = ch;
          c.getContext('2d').drawImage(img, 0, 0, cw, ch);
          URL.revokeObjectURL(url);
          resolve({ base64: c.toDataURL('image/jpeg', 0.92).split(',')[1], media_type: 'image/jpeg' });
        };
        img.onerror = e => { URL.revokeObjectURL(url); reject(e); };
        img.src = url;
      });
      const res = await parseGaugeScreen({
        station_id: stationId, file_base64: base64, media_type,
        shift_id: shiftId, reading_type: 'opening',
      });
      const rows = Array.isArray(res.tanks) ? res.tanks : [];
      // MATCH ON TANK NUMBER, GUARDED BY FUEL.
      // The owner keeps the console's tank numbering aligned with Pumpini's, so the
      // number is an exact, deterministic key — better than any heuristic, and it
      // separates two tanks of the SAME fuel, which fuel or capacity cannot.
      //
      // But nothing in the DB enforces that alignment: add a tank in Settings and
      // number it 2 while the console calls it 3, and a number match would put a
      // DIESEL reading into the PETROL tank. That already happened once on staging
      // (console 1=HSD, 3=MS, 4=Power vs our 1=petrol, 2=diesel). So the number
      // decides WHICH tank, and fuel is the check that the numbering is still sane:
      // if they disagree we fill NOTHING for that row and say so — a visible
      // misconfiguration beats a silently wrong opening stock.
      const norm = v => String(v || '').toLowerCase();

      const usable   = rows.filter(r => r.net_volume_ltrs != null);
      const dropped  = rows.filter(r => r.net_volume_ltrs == null).map(r => r.tank_label ?? '?');
      const claimed  = new Set();
      const pairs    = [];   // [tank, row]
      const unplaced = [];   // console labels with no tank here
      const mismatch = [];   // number matched but the FUEL disagrees — misconfiguration

      usable.forEach(r => {
        const byNumber = dipTanks.find(t => String(t.tank_number) === String(r.tank_label));
        if (byNumber) {
          if (norm(byNumber.fuel_type) !== norm(r.product)) {
            mismatch.push(`${r.tank_label} (${r.product_raw || r.product})`);
            return;                                   // never fill across products
          }
          // Capacity as a CHECK, never a matcher. Number+fuel cannot catch a swap
          // between two tanks of the SAME fuel with crossed numbering — but if their
          // capacities differ, this catches it. Skipped when either side lacks a
          // capacity, so an unmaintained Settings figure can't block a good reading.
          const rc = parseFloat(r.capacity_ltrs), tcap = parseFloat(byNumber.capacity_ltrs);
          if (Number.isFinite(rc) && rc > 0 && Number.isFinite(tcap) && tcap > 0
              && Math.abs(tcap - rc) > rc * 0.01) {
            mismatch.push(`${r.tank_label} (${Math.round(rc)}L vs ${Math.round(tcap)}L)`);
            return;
          }
          if (claimed.has(byNumber.id)) return;        // one row per tank, no overwrite
          claimed.add(byNumber.id); pairs.push([byNumber, r]);
          return;
        }
        // No such number here — fall back to fuel only when it is unambiguous.
        const sameFuel = dipTanks.filter(t => norm(t.fuel_type) === norm(r.product) && !claimed.has(t.id));
        if (sameFuel.length === 1) { claimed.add(sameFuel[0].id); pairs.push([sameFuel[0], r]); }
        else unplaced.push(r.tank_label ?? '?');
      });

      pairs.forEach(([tank, r]) => {
        setDipVol(p => ({ ...p, [tank.id]: String(r.net_volume_ltrs) }));
        setDips(p => ({ ...p, [tank.id]: '' }));
        setSavedDips(p => ({ ...p, [tank.id]: false }));
        // Remember which picture this tank's figure came off. persistDip sends it
        // with the reading so the stock reconciliation can always be traced back to
        // the screen it was read from. Kept even if the manager then corrects the
        // number by hand — the photograph is still the source document, and losing
        // the trail over a one-digit fix would be the worse trade.
        if (res.artifact_id) setDipArtifact(p => ({ ...p, [tank.id]: res.artifact_id }));
      });

      const skipped = [...unplaced, ...dropped];
      setGaugeMsg(
        (pairs.length === 0
          ? tc('sstart.gaugeNone','Could not match any tank on that screen — enter the readings manually.')
          : tc('sstart.gaugeFilled','Filled {n} tank(s) from the screen. Check each figure, then Save.').replace('{n}', pairs.length))
        + (skipped.length  ? ' ' + tc('sstart.gaugeSkipped','Not matched: {list}.').replace('{list}', skipped.join(', ')) : '')
        + (mismatch.length ? ' ' + tc('sstart.gaugeMismatch','Left blank — console tank {list} is a different fuel from the tank of that number here. Check the tank numbering.').replace('{list}', mismatch.join(', ')) : '')
      );
    } catch (e) {
      setErr(e.error || e.response?.data?.error || tc('sstart.gaugeFail','Could not read the screen — enter the readings manually.'));
    } finally { setGaugeBusy(false); }
  };

  // Screen 2 — attendant assignment
  const [opAttendant, setOpAttendant] = useState('');
  const [opPhoto, setOpPhoto] = useState(null);     // { base64, media_type } | null
  const [nozPick, setNozPick] = useState({});       // nozzle_id -> { selected, opening }
  const [openings, setOpenings] = useState({});     // nozzle_id -> the prior close
  // nozzle_id -> 'carried' | 'entered'. THE OPENING IS THE LAST CLOSE (owner rule,
  // 01-Aug): where one exists the server uses it whatever this screen sends, so the
  // box is shown READ-ONLY rather than as an editable field whose value is ignored.
  // 'entered' means no prior close anywhere — a newly commissioned nozzle or the
  // very first shift — and only then is a figure actually needed from the manager.
  const [openSrc, setOpenSrc] = useState({});
  const [scanning, setScanning] = useState('');
  // PhotoCapture holds its own preview; remounting it is the only way to clear that
  // preview after a successful Start, so the next attendant never inherits a face.
  const [formKey, setFormKey] = useState(0);

  const refreshOpen = () => api.get('/shifts', { params:{ station_id: stationId, status:'open' } })
    .then(os => setOpenShifts(Array.isArray(os)?os:[])).catch(()=>{});

  const refreshShift = async (id) => {
    const d = await api.get(`/shifts/${id}`);
    setShift(d); setAttendants(d?.attendants || []);
    const ops = await api.get(`/shifts/${id}/nozzle-openings`).catch(()=>[]);
    const map = {}; const src = {};
    (Array.isArray(ops)?ops:[]).forEach(o => {
      if (o.suggested_opening != null) map[o.nozzle_id] = o.suggested_opening;
      src[o.nozzle_id] = o.source || (o.suggested_opening != null ? 'carried' : 'entered');
    });
    setOpenings(map); setOpenSrc(src);

    // The opening dips the SERVER carried forward from the last close when this
    // shift was opened. A tank that has one needs nothing from the manager — the
    // figure is already the previous closing stock, which is the whole point of
    // the rule. Only a tank with no prior close anywhere is left to be entered.
    const dr = await api.get('/dipstick', { params:{ station_id: stationId, shift_id: id } }).catch(()=>[]);
    const carried = {};
    (Array.isArray(dr)?dr:[]).forEach(x => {
      if (x.reading_type === 'opening') carried[x.tank_id] = x;
    });
    setCarriedDips(carried);
    setSavedDips(p => { const n = { ...p }; Object.keys(carried).forEach(k => { n[k] = true; }); return n; });
  };

  useEffect(() => {
    if (!stationId) return;
    Promise.all([
      api.get(`/shifts/definitions/${stationId}`).catch(()=>[]),
      api.get(`/users?station_id=${stationId}&role=attendant`).catch(()=>[]),
      api.get(`/stations/${stationId}/nozzles`).catch(()=>[]),
      api.get('/shifts', { params:{ station_id: stationId, status:'open' } }).catch(()=>[]),
      api.get(`/dipstick/tanks/${stationId}`).catch(()=>[]),
      api.get(`/prices/${stationId}/current`).catch(()=>[]),
    ]).then(([d,u,n,os,tk,pr]) => {
      const defList = Array.isArray(d)?d:[];
      const openList = Array.isArray(os)?os:[];
      setDefs(defList); setUsers((Array.isArray(u)?u:[]).filter(x=>x.is_active!==false));
      setNozzles((Array.isArray(n)?n:[]).filter(x=>x.is_active));
      setOpenShifts(openList);
      setTanks(Array.isArray(tk)?tk:[]);
      setPrices(Array.isArray(pr)?pr:[]);
      if (!slotTouched.current) setSlot(p => ({ ...p, shift_number: slotForNow(defList) }));

      // ?shift=<id> — the Shifts screen sends "Add Attendant" here rather than
      // carrying its own assign form (retired 01-Aug). The shift is already named,
      // so resume THAT one and go straight to the attendant screen: the dips of a
      // running shift are settled and re-presenting them would be busywork.
      const wanted = openList.find(s => s.id === wantShift);
      if (wanted) {
        shiftRef.current = Promise.resolve(wanted);
        setResumed(true);
        refreshShift(wanted.id)
          .then(() => setStep(1))
          .catch(()=>{ shiftRef.current = null; setResumed(false); });
        return;
      }

      // Resume silently when exactly ONE shift is open today: that is the shift he
      // is working, and making him press Resume for it was pure ceremony. Two or
      // more open is genuinely ambiguous, so the list below stays the way in.
      const mine = openList.filter(s => String(s.date).slice(0,10) === today());
      if (mine.length === 1) {
        shiftRef.current = Promise.resolve(mine[0]);
        setResumed(true);
        refreshShift(mine[0].id).catch(()=>{ shiftRef.current = null; setResumed(false); });
      }
    });
  }, [stationId]);  // eslint-disable-line react-hooks/exhaustive-deps

  const dateKey = d => String(d).slice(0,10);
  const takenSlots = new Set(openShifts.filter(s => dateKey(s.date) === slot.date).map(s => s.shift_number));
  const slotTaken = !shift && takenSlots.has(slot.shift_number);

  const label = n => { const def = defs.find(d=>d.shift_number===n); const sh = tc('sstart.shiftWord','Shift'); return def ? `${sh} ${n} — ${def.name} (${def.start_time}–${def.end_time})` : `${sh} ${n}`; };

  // Create the shift row only when the manager actually commits to something — the
  // first dip save, the gauge photo, or Next. See the file header.
  const ensureShift = async () => {
    if (shift) return shift;
    if (!shiftRef.current) {
      // The chosen slot may already be open (two managers, or a browser left on the
      // page overnight). Joining it is always what was meant — POSTing would only
      // 409 and dead-end him on a screen with no way forward.
      const already = openShifts.find(s => dateKey(s.date) === slot.date && s.shift_number === slot.shift_number);
      shiftRef.current = (already
        ? Promise.resolve(already).then(async s => { await refreshShift(s.id); setResumed(true); return s; })
        : api.post('/shifts', { station_id: stationId, shift_number: slot.shift_number, date: slot.date })
            .then(async s => { await refreshShift(s.id); refreshOpen(); return s; })
      ).catch(e => { shiftRef.current = null; throw e; });
    }
    return shiftRef.current;
  };

  const resumeShift = async (s) => {
    setBusy(true); setErr('');
    try {
      shiftRef.current = Promise.resolve(s);
      await refreshShift(s.id);
      setResumed(true);
      setSlot({ shift_number: s.shift_number, date: dateKey(s.date) });
    }
    catch (e) { shiftRef.current = null; setErr(e.response?.data?.error || e.error || tc('sstart.errLoadShift','Could not load that shift')); }
    setBusy(false);
  };

  // An orphan (opened by mistake) can be deleted only when it has NO operators AND
  // another shift the same day DOES have operators — never the real working shift.
  const canDelete = (s) => (s.attendant_count||0) === 0 && s.id !== shift?.id &&
    openShifts.some(o => o.id !== s.id && dateKey(o.date) === dateKey(s.date) && (o.attendant_count||0) > 0);
  const deleteShift = async (s) => {
    if (!window.confirm(tc('sstart.confirmDeleteShift','Delete this empty shift opened by mistake? This cannot be undone.'))) return;
    setBusy(true); setErr('');
    try { await api.delete(`/shifts/${s.id}`); refreshOpen(); }
    catch (e) { setErr(e.response?.data?.error || e.error || tc('sstart.errDeleteShift','Could not delete shift')); }
    setBusy(false);
  };

  // ── Dipstick ──────────────────────────────────────────────────────
  // Volume for a tank — from the DIP (a physical check) if a dip was entered, else
  // straight from the LITRES field (a reading typed off, or scanned from, the
  // ATG/HPCL system).
  const tankVol = (tank) => {
    const dip = dips[tank.id], litres = dipVol[tank.id];
    const hasChart = tank.diameter_cm && tank.length_cm;
    if (dip !== '' && dip != null) {
      if (hasChart) return dipToVolume(tank.diameter_cm, tank.length_cm, markToTrueDip(dip));
      return litres !== '' && litres != null ? parseFloat(litres) : null;  // no chart → needs manual litres
    }
    return litres !== '' && litres != null ? parseFloat(litres) : null;      // litres entered directly (system)
  };
  const hasReading = (tank) => {
    const dip = dips[tank.id], litres = dipVol[tank.id];
    return (dip !== '' && dip != null) || (litres !== '' && litres != null);
  };
  const isDirty = (tank) => hasReading(tank) && !savedDips[tank.id];

  const persistDip = async (tank, shiftId) => {
    if (!hasReading(tank)) return true;
    const dip = dips[tank.id];
    const hasDip = dip !== '' && dip != null;
    const hasChart = tank.diameter_cm && tank.length_cm;
    const vol = tankVol(tank);
    if (vol == null) { setErr(tc('sstart.errTankVolume','Tank {n}: enter a dip or a litres value.').replace('{n}', tank.tank_number)); return false; }
    // Dip entered → physical reading (store dip_cm). Litres only → system (ATG/HPCL)
    // reading: dip_cm stays null, which is how we tell the two apart.
    const dip_cm = hasDip ? (hasChart ? markToTrueDip(dip) : parseFloat(dip)) : null;
    try {
      const sid = shiftId || (await ensureShift()).id;
      await recordDipstick({
        station_id: stationId, tank_id: tank.id, shift_id: sid,
        reading_type: 'opening', dip_cm, volume_ltrs: vol,
        artifact_id: dipArtifact[tank.id] || null,
      });
      setSavedDips(p => ({ ...p, [tank.id]: true }));
      // Reflect the save inline immediately (so the "last saved" line updates without a reload).
      setTanks(ts => ts.map(t => t.id === tank.id
        ? { ...t, last_dip_cm: dip_cm, last_reading: vol,
            last_reading_at: new Date().toISOString(), last_reading_type: 'opening' }
        : t));
      return true;
    } catch (e) { setErr(e.response?.data?.error || e.error || tc('sstart.errSaveDip','Could not save dip')); return false; }
  };


  // Save whatever is typed but not yet saved before leaving the screen — a figure
  // sitting in a box the manager thought he had entered is the same as no opening
  // stock at all, and he only finds out at reconciliation.
  const flushDips = async (shiftId) => {
    for (const tk of dipTanks) {
      if (!isDirty(tk)) continue;
      const ok = await persistDip(tk, shiftId);
      if (!ok) return false;
    }
    return true;
  };

  // Only liquid tanks are dipped — CNG is sold by mass/pressure, never dip-measured.
  const dipTanks = tanks.filter(t => (t.fuel_type||'').toLowerCase() !== 'cng');

  const goToAttendants = async () => {
    setBusy(true); setErr('');
    try {
      const s = await ensureShift();
      if (!await flushDips(s.id)) return;
      // A tank with nothing entered anywhere. Blocking rather than a toast: the
      // opening stock is what the whole day's wet-stock variance is measured from.
      const missing = dipTanks.filter(tk => !savedDips[tk.id] && !hasReading(tk)).map(tk => tk.tank_number);
      if (missing.length) { setDipWarn(missing); return; }
      setStep(1);
    } catch (e) {
      setErr(e.response?.data?.error || e.error || tc('sstart.errOpenShift','Could not open shift'));
    } finally { setBusy(false); }
  };

  // ── Attendant assignment ──────────────────────────────────────────
  const assignedIds      = new Set(attendants.map(a => a.attendant_id));
  const assignedNozzles  = new Set(attendants.flatMap(a => (a.nozzles||[]).map(nz => nz.nozzle_id)));
  const availNozzles     = nozzles.filter(n => !assignedNozzles.has(n.id));
  const pickNoz = (id, patch) => setNozPick(p => ({ ...p, [id]: { selected:true, opening: openings[id] ?? '', ...(p[id]||{}), ...patch } }));

  const scanMeter = async (nozzle, file) => {
    if (!file || !shift) return;
    setScanning(nozzle.id); setErr('');
    try {
      const b64 = await readB64(file);
      const r = await api.post('/reconcile/ocr-meter', { shift_id: shift.id, nozzle_id: nozzle.id, image_base64: b64, media_type: file.type || 'image/jpeg' });
      if (r.reading) pickNoz(nozzle.id, { selected:true, opening: r.reading });
      if (!r.legible) setErr(tc('sstart.errScanUnclear','Nozzle {n}: scan unclear').replace('{n}', nozzle.nozzle_number) + (r.notes ? ` (${r.notes})` : '') + tc('sstart.errScanCheck',' — check the reading.'));
    } catch (e) { setErr(e.response?.data?.error || e.error || tc('sstart.errScanFailed','Scan failed')); }
    setScanning('');
  };

  // Scan the whole printed pump slip (Slip A/B) — fills the OPENING meter for
  // every nozzle on it, matched by label = "{pump}.{nozzle}" (e.g. 1.1).
  const scanSlip = async (file) => {
    if (!file || !shift) return;
    setScanning('slip'); setErr('');
    try {
      const b64 = await readB64(file);
      const r = await api.post('/reconcile/parse-slip', { shift_id: shift.id, image_base64: b64, media_type: file.type || 'image/jpeg' });
      let matched = 0; const miss = []; const locked = [];
      (r.nozzles || []).forEach(n => {
        if (n.cumulative_volume == null) return;
        // The server resolves the slip line to a real nozzle now — it accepts both
        // "3.1" and plain "3" numbering, and returns nothing rather than guessing
        // when several nozzles share a number. The label match is kept only as a
        // fallback for a backend that has not deployed yet.
        const noz = n.nozzle_id
          ? nozzles.find(x => x.id === n.nozzle_id)
          : nozzles.find(x => String(x.nozzle_number) === n.label);
        if (!noz) { if (n.label) miss.push(n.label); return; }
        // A nozzle whose opening is carried from the last close is TICKED but its
        // figure is left alone. Writing the slip's number into a box the server
        // will overwrite would tell the manager his reading was accepted when it
        // was not. If the slip and the last close genuinely disagree that is a
        // discrepancy to investigate, not an opening to adjust.
        if (openSrc[noz.id] !== 'entered' && openings[noz.id] != null) {
          pickNoz(noz.id, { selected: true });
          if (Math.abs(Number(n.cumulative_volume) - Number(openings[noz.id])) > 1) {
            locked.push(`${n.label} (${tc('sstart.slipSays','slip')} ${n.cumulative_volume} vs ${openings[noz.id]})`);
          }
          matched++;
          return;
        }
        pickNoz(noz.id, { selected: true, opening: n.cumulative_volume });
        matched++;
      });
      if (!matched) setErr(tc('sstart.slipNoMatch','Slip read, but no nozzle matched. Label nozzles as pump.nozzle (e.g. {ex}).').replace('{ex}', `${r.pump_id||'1'}.1`));
      else {
        let msg = tc('sstart.slipTicked','Ticked {n} nozzle(s) from the slip.').replace('{n}', matched);
        if (miss.length)  msg += ' ' + tc('sstart.slipNoMatchSome','No app nozzle for: {x}.').replace('{x}', miss.join(', '));
        if (locked.length) msg += ' ' + tc('sstart.slipDisagrees','⚠ The slip disagrees with the last close for {x}. The last close stands — report this.').replace('{x}', locked.join(', '));
        if (!r.legible)   msg += ' ' + tc('sstart.slipVerify','⚠ Some digits unclear — verify.');
        setErr(msg);
      }
    } catch (e) { setErr(e.response?.data?.error || e.error || tc('sstart.slipFailed','Slip scan failed')); }
    setScanning('');
  };

  // ONE button on this screen. It photographs, assigns and clocks the attendant in
  // in a single press, then clears itself for the next man — the manager comes back
  // here as each attendant arrives, until every nozzle is manned.
  const startAttendant = async () => {
    if (!opAttendant) { setErr(tc('sstart.errPickAttendant','Pick the attendant')); return; }
    const chosen = nozzles.filter(n => nozPick[n.id]?.selected).map(n => {
      const v = nozPick[n.id].opening;
      const opening = v !== '' && v != null ? parseFloat(v) : (openings[n.id] != null ? Number(openings[n.id]) : 0);
      return { nozzle_id: n.id, opening_reading: opening };
    });
    if (!chosen.length) { setErr(tc('sstart.errPickNozzle','Tick at least one nozzle for this attendant')); return; }
    setBusy(true); setErr('');
    try {
      const s = await ensureShift();
      await api.post(`/shifts/${s.id}/assign`, {
        attendant_id: opAttendant,
        nozzles: chosen,
        // OPENING FLOAT IS ALWAYS ZERO (owner, 01-Aug-2026): no outlet hands the
        // attendant a float, so the field was pure typing — and a mistyped float
        // shows up that evening as a phantom overage against the blind drop. The
        // input is HIDDEN rather than the field deleted: the API still requires the
        // key, and the day an outlet does give a float it comes back as a UI change
        // with no migration behind it.
        opening_cash: 0,
        photo_base64: opPhoto?.base64 || null,
        photo_media_type: opPhoto?.media_type || null,
      });
      setOpAttendant(''); setOpPhoto(null); setNozPick({}); setFormKey(k => k + 1);
      await refreshShift(s.id); refreshOpen();
    } catch (e) {
      setErr(e.response?.data?.error || e.error || tc('sstart.errStartAttendant','Could not start this attendant'));
    } finally { setBusy(false); }
  };

  return (
    <AppShell>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:'0.5rem',flexWrap:'wrap'}}>
        <button onClick={()=>router.push('/dashboard')} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-3)',display:'flex',alignItems:'center',gap:4,fontSize:13}}><ArrowLeft size={15}/>{tc('sstart.dashboard','Dashboard')}</button>
        <ChevronRight size={14} color="var(--text-3)"/>
        <span style={{fontWeight:800,fontSize:15}}>{tc('sstart.startShift','Start Shift')}</span>
      </div>

      {/* Current selling price — reminder to keep the system in step with the board during parallel run */}
      {prices.length>0 && (
        <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:8,padding:'8px 12px',marginBottom:'1rem'}}>
          <span style={{fontSize:11.5,fontWeight:800,color:'#92400e',textTransform:'uppercase',letterSpacing:'.04em'}}>{tc('sstart.sellingPriceInSystem','Selling price in system')}</span>
          {prices.map(p=>(
            <span key={p.fuel_type} style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:14,fontWeight:800}}>
              <span className={`fuel-chip fuel-${p.fuel_type}`} style={{textTransform:'capitalize'}}>{String(p.fuel_type).replace('_',' ')}</span>
              ₹{Number(p.price).toFixed(2)}
              {p.effective_from && <span style={{fontSize:10.5,fontWeight:500,color:'#a16207'}}>{tc('sstart.since','since')} {new Date(p.effective_from).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</span>}
            </span>
          ))}
          <span style={{fontSize:11.5,color:'#92400e',marginLeft:'auto'}}>⚠ {tc('sstart.boardPriceChangedPre','Board price changed? Update it in')} <strong>{tc('sstart.pricesLink','Prices')}</strong> {tc('sstart.boardPriceChangedPost','before the shift runs.')}</span>
        </div>
      )}

      {/* Stepper — TWO steps. Moving forward goes through goToAttendants so the dips
          are saved and checked on the way, exactly as the Next button does. */}
      <div style={{display:'flex',gap:6,marginBottom:'1.25rem',flexWrap:'wrap'}}>
        {STEPS.map((s,i)=>(
          <button key={s} onClick={()=>{ if (i===0) setStep(0); else if (!busy) goToAttendants(); }} disabled={busy}
            style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:99,fontSize:13,fontWeight:600,
              border:'1.5px solid '+(i===step?'#FF6B00':'#e5e3de'),
              background:i<step?'#16a34a':i===step?'#fff7ed':'#fff',
              color:i<step?'#fff':i===step?'#9a3412':'#888',cursor:busy?'default':'pointer'}}>
            <span style={{width:18,height:18,borderRadius:'50%',background:i<step?'rgba(255,255,255,.3)':i===step?'#FF6B00':'#e5e3de',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11}}>{i<step?<Check size={12}/>:i+1}</span>
            {tc('sstart.step'+s, s === 'Gauge' ? 'Gauge & dip' : 'Attendants')}
          </button>
        ))}
      </div>

      {err && <div style={{background:'#fee2e2',color:'#991b1b',borderRadius:8,padding:'10px 12px',fontSize:13,marginBottom:12}}>{err}</div>}

      {/* Which shift are we working on — one compact strip instead of a whole step. */}
      <div style={{background:'#f8fafc',border:'1px solid #eef0f2',borderRadius:10,padding:'10px 12px',marginBottom:'1rem'}}>
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          {shift ? (
            <>
              <span style={{fontWeight:700,fontSize:13.5}}>{label(shift.shift_number)}</span>
              <span style={{fontSize:12.5,color:'var(--text-3)'}}>{fmtDay(shift.date)}</span>
              <span style={{fontSize:11.5,fontWeight:700,color:'#166534',background:'#dcfce7',borderRadius:99,padding:'2px 9px'}}>
                {resumed ? tc('sstart.resumedShift','Continuing the shift already open') : tc('sstart.shiftOpened','Shift opened')}
              </span>
            </>
          ) : (
            <>
              <select style={{...inp,width:'auto',minWidth:230,padding:'6px 9px',fontSize:13}} value={slot.shift_number}
                onChange={e=>{ slotTouched.current = true; setSlot(p=>({...p,shift_number:parseInt(e.target.value)})); }}>
                {[1,2,3].map(n=><option key={n} value={n} disabled={takenSlots.has(n)}>{label(n)}{takenSlots.has(n)?tc('sstart.alreadyOpenSuffix',' — already open'):''}</option>)}
              </select>
              <input style={{...inp,width:'auto',padding:'6px 9px',fontSize:13}} type="date" value={slot.date}
                onChange={e=>{ slotTouched.current = true; setSlot(p=>({...p,date:e.target.value})); }}/>
              <span style={{fontSize:11.5,color:'var(--text-3)'}}>{tc('sstart.lazyShiftHint','The shift opens when you save the first reading — nothing is created by just looking.')}</span>
            </>
          )}
          {slotTaken && <span style={{fontSize:11.5,color:'#b45309'}}>{tc('sstart.slotOpenHint2','That slot is already open — resume it below or pick another.')}</span>}
        </div>

        {/* Currently open shifts — the resume/delete affordance, kept but compact. */}
        {openShifts.length>0 && (
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:8,paddingTop:8,borderTop:'1px dashed #e5e3de'}}>
            <span style={{fontSize:11.5,fontWeight:700,color:'var(--text-3)',alignSelf:'center'}}>{tc('sstart.currentlyOpenShifts','Currently open shifts')}</span>
            {openShifts.map(s=>(
              <span key={s.id} style={{display:'inline-flex',alignItems:'center',gap:6,background:s.id===shift?.id?'#fff7ed':'#fff',border:'1px solid '+(s.id===shift?.id?'#fed7aa':'#e5e3de'),borderRadius:99,padding:'3px 6px 3px 11px',fontSize:12}}>
                <span style={{fontWeight:700}}>{tc('sstart.shiftWord','Shift')} {s.shift_number}</span>
                <span style={{color:'var(--text-3)'}}>{fmtDay(s.date)} · {tc('sstart.nOperators','{n} operators').replace('{n}', s.attendant_count||0)}</span>
                {s.id!==shift?.id && (
                  <button onClick={()=>resumeShift(s)} disabled={busy} style={{padding:'3px 9px',background:'#fff7ed',color:'#9a3412',border:'1px solid #fed7aa',borderRadius:99,fontSize:11.5,fontWeight:700,cursor:'pointer'}}>{tc('sstart.resumeBtn','Resume →')}</button>
                )}
                {canDelete(s) && (
                  <button onClick={()=>deleteShift(s)} disabled={busy} title={tc('sstart.deleteEmptyShift','Delete this empty shift (opened by mistake)')}
                    style={{padding:'3px 7px',background:'#fef2f2',color:'#b91c1c',border:'1px solid #fecaca',borderRadius:99,fontSize:11.5,fontWeight:700,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:3}}>
                    <X size={11}/>{tc('sstart.delete','Delete')}
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── SCREEN 1 — Gauge & opening dip ───────────────────────────── */}
      {step===0 && (
        <div className="card" style={{maxWidth:640}}>
          <div style={{fontWeight:700,fontSize:15,marginBottom:'0.25rem',display:'flex',alignItems:'center',gap:6}}><Droplets size={16} color="#0ea5e9"/>{tc('sstart.openingDipReadings','Opening dip readings')}</div>
          <div style={{fontSize:12.5,color:'var(--text-3)',marginBottom:'1rem'}}>{tc('sstart.dipHelpCarried','The opening stock is whatever the last shift closed at — it is carried across automatically so no litre can go missing between two shifts. You only enter a reading for a tank that has no previous close.')}</div>

          {/* The photograph is the headline action now: one picture fills every tank
              below. Outlets with no console (e.g. IOCL) simply take a physical dip
              and type it — the boxes underneath are unchanged and still primary. */}
          {dipTanks.length>0 && (
            <div style={{marginBottom:'1rem',background:'#f0f9ff',border:'1px solid #bae6fd',borderRadius:10,padding:'12px'}}>
              <label style={{display:'inline-flex',alignItems:'center',gap:8,padding:'11px 16px',borderRadius:9,
                border:'none',background:gaugeBusy?'#94a3b8':'#0369a1',fontSize:14,fontWeight:800,
                cursor:gaugeBusy?'wait':'pointer',color:'#fff'}}>
                <ScanLine size={17}/>
                {gaugeBusy ? tc('sstart.gaugeReading','Reading screen…') : tc('sstart.gaugeScanCta','Take a photo of the gauge screen')}
                <input type="file" accept="image/*" capture="environment" style={{display:'none'}} disabled={gaugeBusy}
                  onChange={e=>{ handleGaugeScan(e.target.files?.[0]); e.target.value=''; }}/>
              </label>
              <div style={{fontSize:11.5,color:'#0c4a6e',marginTop:7}}>{tc('sstart.gaugeScanHint','The readings fill in below. Check every figure — they stay editable.')}</div>
              {gaugeMsg && <div style={{fontSize:12,color:'#b45309',marginTop:6}}>{gaugeMsg}</div>}
            </div>
          )}

          {dipTanks.length===0 && <div style={{color:'#aaa',fontSize:13}}>{tc('sstart.noDipTanks','No dip-measured tanks configured.')}</div>}
          {dipTanks.map(tk => {
            const hasChart = tk.diameter_cm && tk.length_cm;
            const vol = tankVol(tk);
            // Carried from the last close by the server. Nothing to do, nothing to
            // type — showing entry boxes here would invite a manager to "correct"
            // the very figure the rule exists to keep fixed.
            const cd = carriedDips[tk.id];
            if (cd) return (
              <div key={tk.id} style={{marginBottom:10,paddingBottom:10,borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                <div style={{width:120,fontSize:13,fontWeight:600}}>{tc('sstart.tank','Tank')} {tk.tank_number} <span style={{color:'#888',fontWeight:400}}>{tk.fuel_type}</span></div>
                <div style={{fontSize:14,fontWeight:800,color:'#0f172a'}}>{fmtL(cd.volume_ltrs)} L</div>
                {cd.dip_cm != null && <div style={{fontSize:12,color:'#64748b'}}>{tc('sstart.dipLabel','dip')} {cd.dip_cm} cm</div>}
                <span style={{fontSize:11.5,color:'#166534',background:'#dcfce7',borderRadius:99,padding:'3px 10px',fontWeight:700}}>
                  🔒 {tc('sstart.carriedFromLastClose','Carried from last close')}
                </span>
              </div>
            );
            return (
              <div key={tk.id} style={{padding:'10px 0',borderBottom:'1px solid #f1f5f9'}}>
                {/* ONE ROW PER TANK: name, dip, litres. The per-tank Save button is
                    gone — the gauge photo fills every tank at once and Next commits
                    whatever is on screen (flushDips), so asking for a line-level
                    commit as well was ceremony that made a three-tank screen look
                    like eighteen controls. The row now says what it is and takes
                    two numbers, which is all it ever did. */}
                <div style={{display:'grid',gridTemplateColumns:'1fr 104px 116px',gap:8,alignItems:'center'}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:13.5,fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                      {tc('sstart.tank','Tank')} {tk.tank_number}
                    </div>
                    <div style={{fontSize:11.5,color:'var(--text-3)',textTransform:'capitalize'}}>
                      {String(tk.fuel_type||'').replace('_',' ')}
                    </div>
                  </div>
                  <input style={{...inp,padding:'9px 10px'}} type="number" step="0.1" inputMode="decimal"
                    placeholder={hasChart?tc('sstart.dipShort','Dip'):tc('sstart.dipCm','dip cm')}
                    value={dips[tk.id]||''} onChange={e=>{ setDips(p=>({...p,[tk.id]:e.target.value})); setSavedDips(p=>({...p,[tk.id]:false})); }}/>
                  <input style={{...inp,padding:'9px 10px',...((dips[tk.id]!=='' && dips[tk.id]!=null && hasChart)?{background:'#f1f5f9',color:'#0369a1',fontWeight:700}:{})}}
                    type="number" step="0.01" inputMode="decimal"
                    placeholder={tc('sstart.litresShort','Litres')}
                    readOnly={dips[tk.id]!=='' && dips[tk.id]!=null && hasChart}
                    value={(dips[tk.id]!=='' && dips[tk.id]!=null && hasChart) ? (vol!=null?fmtL(vol):'') : (dipVol[tk.id]||'')}
                    onChange={e=>{ setDipVol(p=>({...p,[tk.id]:e.target.value})); setSavedDips(p=>({...p,[tk.id]:false})); }}/>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8,marginTop:5,minHeight:20}}>
                  {savedDips[tk.id] && <span style={{fontSize:11.5,fontWeight:700,color:'#166534'}}>{tc('sstart.saved','✓ Saved')}</span>}
                  {dipArtifact[tk.id] && <ArtifactImage artifactId={dipArtifact[tk.id]} size={34} label={tc('sstart.gaugePhotoLabel','Gauge screen this figure came from')}/>}
                </div>
                {/* Last saved reading — so a blank entry box never looks like lost data. */}
                {tk.last_reading_at
                  ? <div style={{fontSize:11.5,color:'#475569',marginTop:4}}>
                      <span style={{color:'#16a34a',fontWeight:700}}>● {tc('sstart.lastSaved','Last saved')}</span>{' '}
                      {tk.last_reading_type ? `${tk.last_reading_type} ` : ''}{tc('sstart.dipLabel','dip')} {tk.last_dip_cm!=null?`${tk.last_dip_cm} cm`:'—'}
                      {tk.last_reading!=null?` → ${fmtL(tk.last_reading)} L`:''} · {fmtWhen(tk.last_reading_at)}
                    </div>
                  : <div style={{fontSize:11.5,color:'#94a3b8',marginTop:4}}>{tc('sstart.noReadingYet','No reading saved yet for this tank.')}</div>}
              </div>
            );
          })}
          <button onClick={goToAttendants} disabled={busy} style={{width:'100%',height:46,marginTop:12,background:busy?'#cbd5e1':'#FF6B00',color:'#fff',border:'none',borderRadius:10,fontWeight:800,fontSize:15,cursor:busy?'default':'pointer'}}>
            {busy ? tc('sstart.savingReadings','Saving…') : tc('sstart.nextAttendants','Next: Attendant assignment →')}
          </button>
        </div>
      )}

      {/* ── SCREEN 2 — Attendant assignment ──────────────────────────── */}
      {step===1 && (
        <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1.25rem',alignItems:'start'}}>
          <div className="card">
            <div style={{fontWeight:700,fontSize:15,marginBottom:'0.75rem'}}>{tc('sstart.attendantAssignment','Attendant assignment')}</div>
            <div style={{display:'grid',gap:12}}>

              {/* PHOTO FIRST — this is phase 0 of facial recognition, not a snapshot
                  for the file. Once the model is mature the picture FETCHES the
                  attendant and the picker below becomes the fallback for the days it
                  cannot (bad light, new face). Ordering it first now is what makes
                  that swap a deletion rather than a redesign. No matching is done
                  today; the photo is stored against the assignment. */}
              <div>
                <label className="label">{tc('sstart.attendantPhoto','Photo of the attendant')}</label>
                <PhotoCapture key={formKey}
                  label={tc('sstart.takeAttendantPhoto','Take his photo')}
                  hint={tc('sstart.attendantPhotoHint','Taken as he starts. In time this photo will identify him on its own.')}
                  disabled={busy}
                  onCapture={setOpPhoto}/>
              </div>

              <div><label className="label">{tc('sstart.attendant','Attendant')}</label>
                <select style={inp} value={opAttendant} onChange={e=>setOpAttendant(e.target.value)}>
                  <option value="">{tc('sstart.selectPlaceholder','Select…')}</option>
                  {users.filter(u=>!assignedIds.has(u.id)).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
                </select></div>

              {/* Opening float is deliberately absent — see startAttendant(). */}

              <div>
                <label className="label">{tc('sstart.nozzlesHeMans','Nozzles he mans')} <span style={{fontWeight:400,color:'#888'}}>{tc('sstart.nozzlesHeMansHint','(tick each; opening auto-carries from last close)')}</span></label>
                <label style={{display:'inline-flex',alignItems:'center',gap:8,marginBottom:8,padding:'8px 12px',background:scanning==='slip'?'#94a3b8':'#0f766e',color:'#fff',borderRadius:8,cursor:scanning==='slip'?'default':'pointer',fontSize:13,fontWeight:600}}>
                  📄 {scanning==='slip' ? tc('sstart.slipReading','Reading slip…') : tc('sstart.scanSlip','Scan pump slip → fill all nozzles')}
                  <input type="file" accept="image/*" capture="environment" disabled={scanning==='slip'} style={{display:'none'}} onChange={e=>{ scanSlip(e.target.files?.[0]); e.target.value=''; }}/>
                </label>
                {availNozzles.length===0 && <div style={{fontSize:12.5,color:'#aaa'}}>{tc('sstart.allNozzlesAssigned','All nozzles are already assigned.')}</div>}
                {availNozzles.map(n=>{
                  const pick = nozPick[n.id]; const sel = !!pick?.selected;
                  const sug = openings[n.id];
                  // Carried = the last close, and the server will use it regardless.
                  const carried = openSrc[n.id] !== 'entered' && sug != null;
                  const cur = carried ? sug : (pick?.opening ?? '');
                  return (
                    <div key={n.id} style={{border:'1px solid '+(sel?'#fed7aa':'#eef0f2'),background:sel?'#fff7ed':'#fff',borderRadius:8,padding:'8px 10px',marginBottom:6}}>
                      <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,fontWeight:600}}>
                        <input type="checkbox" checked={sel} onChange={e=>{ if(e.target.checked) pickNoz(n.id,{selected:true}); else setNozPick(p=>({...p,[n.id]:{...(p[n.id]||{}),selected:false}})); }}/>
                        {tc('sstart.nozzle','Nozzle')} {n.nozzle_number} <span style={{color:'#888',fontWeight:400}}>{n.fuel_type}</span>
                      </label>
                      {sel && (
                        <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8}}>
                          <input style={{...inp,flex:1,...(carried?{background:'#f1f5f9',color:'#0f172a',fontWeight:700}:{})}}
                            type="number" step="0.001" readOnly={carried}
                            placeholder={tc('sstart.openingMeter','Opening meter')}
                            value={cur} onChange={e=>{ if(!carried) pickNoz(n.id,{opening:e.target.value}); }}/>
                          {/* The totalizer scan is offered only where there is no close
                              to carry. Elsewhere it could only produce a figure that is
                              then discarded, which reads as the app losing the reading. */}
                          {!carried && (
                            <label title={tc('sstart.scanTotalizer','Scan the totalizer')} style={{flexShrink:0,width:40,height:36,display:'flex',alignItems:'center',justifyContent:'center',background:scanning===n.id?'#94a3b8':'#475569',color:'#fff',borderRadius:8,cursor:scanning===n.id?'default':'pointer',fontSize:16}}>
                              {scanning===n.id?'…':'📷'}
                              <input type="file" accept="image/*" capture="environment" disabled={scanning===n.id} style={{display:'none'}} onChange={e=>{ scanMeter(n, e.target.files?.[0]); e.target.value=''; }}/>
                            </label>
                          )}
                        </div>
                      )}
                      {sel && carried && (
                        <div style={{fontSize:11,color:'#475569',marginTop:4}}>
                          🔒 {tc('sstart.carriedFromClose','Carried from the last close — the opening must equal it, so there is no gap between shifts.')}
                        </div>
                      )}
                      {sel && !carried && (
                        <div style={{fontSize:11,color:'#b45309',marginTop:4}}>
                          ⚠ {tc('sstart.noPriorClose','No previous close for this nozzle — enter its opening meter. This is only expected on a new nozzle or the first shift.')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* THE only button on this screen. */}
              <button onClick={startAttendant} disabled={busy}
                style={{height:50,background:busy?'#cbd5e1':'#FF6B00',color:'#fff',border:'none',borderRadius:10,fontWeight:800,fontSize:15,cursor:busy?'default':'pointer'}}>
                {busy ? tc('sstart.starting','Starting…') : tc('sstart.startAttendant','Start shift for this attendant')}
              </button>
            </div>
          </div>

          <div className="card">
            <div style={{fontWeight:700,fontSize:15,marginBottom:'0.75rem'}}>{tc('sstart.startedCount','Started ({n})').replace('{n}', attendants.length)}</div>
            {attendants.length===0 ? <div style={{color:'#aaa',fontSize:13}}>{tc('sstart.noneStartedYet','Nobody has started yet.')}</div>
              : attendants.map(a=>(
                <div key={a.id} style={{display:'flex',gap:10,background:'#f8fafc',borderRadius:8,padding:'10px 12px',marginBottom:8}}>
                  {/* Renders a placeholder when there is no photo — an attendant
                      started before the camera existed (or with it broken) still
                      shows up in full. */}
                  <ArtifactImage artifactId={a.photo_start_artifact_id} size={44} label={a.attendant_name}/>
                  <div style={{minWidth:0,flex:1}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
                      <div style={{fontWeight:700,fontSize:13.5}}>{a.attendant_name}</div>
                      {a.started_at && <div style={{fontSize:11.5,color:'#166534',fontWeight:700}}>{tc('sstart.startedAt','from')} {fmtClock(a.started_at)}</div>}
                    </div>
                    {(a.nozzles||[]).length>0
                      ? <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:6}}>
                          {a.nozzles.map(nz=>(
                            <span key={nz.nozzle_id} style={{fontSize:11.5,background:'#eef2ff',color:'#3730a3',borderRadius:99,padding:'2px 8px'}}>
                              N{nz.nozzle_number} · {nz.fuel_type} · {tc('sstart.open','open')} {Number(nz.opening_reading||0)}
                            </span>
                          ))}
                        </div>
                      : <div style={{fontSize:11.5,color:'#b45309',marginTop:4}}>{tc('sstart.noNozzlesAssigned','No nozzles assigned')}</div>}
                  </div>
                </div>
              ))}

            {/* The flow ends when every nozzle has a man on it — so say what is left. */}
            {availNozzles.length===0 ? (
              <div style={{background:'#dcfce7',border:'1px solid #86efac',color:'#166534',borderRadius:8,padding:'10px 12px',fontSize:12.5,fontWeight:700,marginTop:12}}>
                ✓ {tc('sstart.allNozzlesManned','All nozzles are assigned — the shift is fully manned.')}
              </div>
            ) : (
              <div style={{background:'#fffbeb',border:'1px solid #fde68a',borderRadius:8,padding:'10px 12px',marginTop:12}}>
                <div style={{fontSize:12.5,fontWeight:700,color:'#92400e'}}>{tc('sstart.nozzlesUnmanned','{n} nozzle(s) still unmanned').replace('{n}', availNozzles.length)}</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:6}}>
                  {availNozzles.map(n=>(
                    <span key={n.id} style={{fontSize:11.5,background:'#fff',border:'1px solid #fde68a',color:'#92400e',borderRadius:99,padding:'2px 8px'}}>
                      N{n.nozzle_number} · {n.fuel_type}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Attendants arrive at different times, so leaving with nozzles still
                unmanned is normal — the manager comes back to this screen. */}
            <div style={{fontSize:12,color:'var(--text-3)',marginTop:12,marginBottom:6}}>{tc('sstart.staggerHint2','Each attendant goes live the moment you press Start. Stay here for the next one, or leave and come back as they arrive.')}</div>
            <button onClick={()=>router.push('/dashboard')} disabled={busy}
              style={{width:'100%',height:46,background:'#0f172a',color:'#fff',border:'none',borderRadius:10,fontWeight:800,fontSize:15,cursor:'pointer'}}>
              {tc('sstart.doneToDashboard','Done — go to dashboard')}
            </button>
          </div>
        </div>
      )}

      {/* Missing opening dip — blocking, because the day's wet-stock variance is
          measured from this figure and a tank with no opening reading makes it
          meaningless. Not a hard stop: an outlet mid-changeover may genuinely have
          to come back to it. */}
      {dipWarn && (
        <div style={{position:'fixed',inset:0,background:'rgba(15,23,42,.6)',zIndex:400,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
          <div style={{background:'#fff',borderRadius:12,padding:'18px 20px',maxWidth:440,width:'100%'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,fontWeight:800,fontSize:15,marginBottom:8}}>
              <AlertTriangle size={18} color="#b45309"/>{tc('sstart.dipMissingTitle','Some tanks have no opening reading')}
            </div>
            <div style={{fontSize:13,color:'#475569',marginBottom:16}}>
              {tc('sstart.dipMissingBody','Tank {list} has no opening dip. Without it, today’s stock variance for that tank cannot be trusted.').replace('{list}', dipWarn.join(', '))}
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',flexWrap:'wrap'}}>
              <button onClick={()=>setDipWarn(null)} style={{padding:'10px 14px',background:'#FF6B00',color:'#fff',border:'none',borderRadius:8,fontWeight:700,fontSize:13,cursor:'pointer'}}>
                {tc('sstart.dipMissingBack','Enter the readings')}
              </button>
              <button onClick={()=>{ setDipWarn(null); setStep(1); }} style={{padding:'10px 14px',background:'#fff',color:'#475569',border:'1.5px solid #e5e3de',borderRadius:8,fontWeight:700,fontSize:13,cursor:'pointer'}}>
                {tc('sstart.dipMissingGo','Continue anyway')}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
