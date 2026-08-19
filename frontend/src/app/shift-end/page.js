'use client';
// End Shift — TWO screens, mirroring the two at Start Shift.
//
//   1. SETTLE ATTENDANTS — for one operator at a time: his photograph, then who he
//      is, then his nozzles' closing meters, then the settlement breakup, then
//      close him. Come back to the same working area for the next operator until
//      every open operator is out.
//   2. CLOSING GAUGE & DIP — photograph the gauge screen / dip each tank, then
//      close the shift.
//
// It used to be three screens, the first of which only asked "which shift?" — a
// whole step for a question that has exactly one answer at nearly every outlet.
// That shift choice now lives inline at the top of screen 1 and is made for the
// manager when only one shift is open.
//
// WHY THE PHOTO COMES BEFORE THE PICKER (owner, 01-Aug-2026): the photograph is
// PHASE 0 OF FACIAL RECOGNITION. Today it is evidence and the list below it is how
// the operator is identified. Once the model is mature the picture IDENTIFIES him
// and the list becomes the FALLBACK for when the match is unsure — so the camera
// is already first in the order of work, and the manager's habit will not have to
// change when matching lands. No matching is done here yet.
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/navigation';
import { Check, ChevronRight, ArrowLeft, AlertTriangle, CheckCircle, Clock, Droplets, ScanLine } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import PhotoCapture from '../../components/shared/PhotoCapture';
import ArtifactImage from '../../components/shared/ArtifactImage';
import api, { parseGaugeScreen, getLatestArtifacts, parseSlips } from '../../lib/api';
import { describe as describeFace, bestMatch, preload as preloadFace } from '../../lib/face';
import { useAuth } from '../../lib/auth';
import { markToTrueDip, dipToVolume } from '../../lib/calibration';
import { matchGaugeRows } from '../../lib/gaugeMatch';

const inp = { width:'100%', padding:'8px 10px', border:'1.5px solid #e5e3de', borderRadius:8, fontSize:13.5, outline:'none', boxSizing:'border-box', background:'#fff' };
const fmt = n => `₹${Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmtDate = s => s ? new Date(s).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric'}) : '';
// Day-and-time, always en-IN / Asia/Kolkata: a shift clock read as MM/DD would put
// a night shift on the wrong day. hour12 keeps it readable on the forecourt.
const fmtWhen = (ts) => ts ? new Date(ts).toLocaleString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:true }) : '';
const fmtL = n => Number(n||0).toFixed(2);
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
// Two chips, not three — the shift choice is no longer a step of its own.
const STEPS = [
  { key:'Settle',     label:'Settle' },
  { key:'ClosingDip', label:'Closing dip' },
];
const hoursSince = (t) => t ? (Date.now() - new Date(t).getTime())/3.6e6 : 0;
const openedLabel = (t) => { const h = hoursSince(t); return h < 1 ? `${Math.round(h*60)}m ago` : h < 24 ? `${h.toFixed(1)}h ago` : `${Math.floor(h/24)}d ${Math.round(h%24)}h ago`; };
const readB64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('Could not read image'));
  r.readAsDataURL(file);
});

export default function ShiftEndPage() {
  const router = useRouter();
  const { station, setActiveShift } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };

  const [step, setStep]   = useState(0);
  const [open, setOpen]   = useState([]);
  const [shift, setShift] = useState(null);
  const [prices, setPrices] = useState({});       // fuel_type -> price
  const [forms, setForms] = useState({});         // attendant_id -> { closings:{nozzle_id:val}, cash, card, upi, credit, petty }
  const [closed, setClosed] = useState({});       // attendant_id -> { variance, total_sales, at }
  const [sel, setSel]     = useState('');         // attendant_id in the working area
  const [photo, setPhoto] = useState(null);       // { base64, media_type } for the operator being closed
  const [photoSlot, setPhotoSlot] = useState(0);  // bumps to remount PhotoCapture between operators
  // PHASE 1 OF FACIAL RECOGNITION, close side. Same contract as shift start:
  // the picture PROPOSES which operator is handing over and the list confirms.
  // Candidates here are only the men still unsettled on THIS shift, so it cannot
  // propose somebody who was never on it.
  const [faceRefs, setFaceRefs] = useState({});
  const [faceMsg, setFaceMsg]   = useState('');
  const [faceVerdict, setFaceVerdict] = useState(null);

  // Warm the weights as the close screen opens, so the handover photo does not wait.
  useEffect(() => { preloadFace(); }, []);

  const loadFaceRefs = async (people) => {
    const ids = (people||[]).map(a => a.attendant_id).filter(Boolean);
    if (!ids.length) return;
    try {
      const m = await getLatestArtifacts('user', ids, 'attendant_photo');
      const refs = {};
      Object.entries(m||{}).forEach(([uid,row]) => {
        const d = row?.meta?.descriptor;
        if (Array.isArray(d) && d.length === 128) refs[uid] = d;
      });
      setFaceRefs(refs);
    } catch { /* the list is right there; a missing suggestion costs nothing */ }
  };

  const onFacePhoto = async (shot) => {
    setPhoto(shot);
    setFaceMsg(''); setFaceVerdict(null);
    if (!shot?.base64) return;
    const candidates = (shift?.attendants || [])
      .filter(a => !closed[a.attendant_id] && faceRefs[a.attendant_id])
      .map(a => ({ user_id: a.attendant_id, name: a.attendant_name, descriptor: faceRefs[a.attendant_id] }));
    if (!candidates.length) return;          // nobody enrolled — stay silent, this is the close screen
    setFaceMsg(tc('send.faceReading','Reading the face…'));
    const { descriptor, error } = await describeFace(
      `data:${shot.media_type || 'image/jpeg'};base64,${shot.base64}`);
    if (error || !descriptor) {
      setFaceMsg(error === 'many-faces'
        ? tc('send.faceMany','More than one face in frame — pick him from the list.')
        : tc('send.faceUnread','Could not read the face — pick him from the list.'));
      return;
    }
    const m = bestMatch(descriptor, candidates);
    if (!m) { setFaceMsg(''); return; }
    setFaceVerdict(m);
    if (m.verdict === 'strong' || m.verdict === 'likely') {
      setSel(m.user_id);
      setFaceMsg((m.verdict === 'strong'
        ? tc('send.faceStrong','This looks like {name} — selected below. Check it before you settle him.')
        : tc('send.faceLikely','This is probably {name} — selected below. Worth a second look.')
      ).replace('{name}', m.name));
    } else {
      setFaceMsg(tc('send.faceUnsure','Not sure who this is — closest is {name}. Pick him from the list.')
        .replace('{name}', m.name));
    }
  };
  const [scanning, setScanning] = useState('');   // nozzle_id being OCR'd
  // A composite "scan all slips" photo has been read this session. While true the
  // per-nozzle totalizer cameras are DISABLED so the two capture paths cannot fight
  // over the same closing box — but the reading fields stay hand-editable, and the
  // "Retake / clear" affordance flips this back to re-enable the per-nozzle cameras.
  const [compositeScanned, setCompositeScanned] = useState(false);
  const [tanks, setTanks] = useState([]);
  const [dips, setDips]   = useState({});         // tank_id -> entered mark-ordinal (a physical dip)
  const [dipVol, setDipVol] = useState({});       // tank_id -> litres (a system/ATG reading)
  const [savedDips, setSavedDips] = useState({});
  const [dipArtifact, setDipArtifact] = useState({});  // tank_id -> artifact_id of the gauge photo that filled it
  const [gaugeBusy, setGaugeBusy] = useState(false);
  const [gaugeMsg, setGaugeMsg]   = useState('');
  const [gaugeArtifact, setGaugeArtifact] = useState('');
  // tank_id -> the closing reading ALREADY stored for this shift. Holds the ROW, not
  // just the id, because a stored reading is now DISPLAYED here rather than merely
  // exempted from the nag: at a handover the next shift's start screen takes this
  // measurement (one scan closes the running shift and becomes the next opening), so
  // by the time the manager reaches Shift Close the figure is usually already in.
  // Showing an empty box over a stored reading is what taught managers the second ask
  // was optional — and it is exactly how Highway and Adhoc Highway went three days
  // with opening dips and no closing ones at all.
  const [shiftDips, setShiftDips] = useState({});
  const [dipWarn, setDipWarn] = useState(null);   // { missing:[tank] } | null
  // The scanned pump slips kept against THIS shift. They were already being
  // stored (reconcile.js saves the picture as a `nozzle_slip` artifact on the
  // shift) — nothing ever showed them, so the evidence behind every closing
  // meter was write-only. Metadata only; ArtifactImage fetches the bytes.
  const [slips, setSlips] = useState([]);
  const [busy, setBusy]   = useState('');
  const [err, setErr]     = useState('');
  const [done, setDone]   = useState(false);

  // Auto-pick fires once per mount only — a manager who deliberately switched to
  // another open shift must not have the list yank him back.
  const autoPicked = useRef(false);

  useEffect(() => {
    if (!stationId) return;
    api.get('/shifts', { params:{ station_id: stationId, status:'open' } })
      .then(r => {
        const list = Array.isArray(r) ? r : [];
        setOpen(list);
        if (autoPicked.current) return;
        // ?shift=<id> — the Shifts screen's "End Shift" button has always sent this
        // and nothing ever read it, so a manager who named a shift there still had
        // to pick it again here. Honoured now; an unknown or already-closed id just
        // falls through to the rules below.
        const wanted = typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('shift') : null;
        const named = wanted && list.find(s => s.id === wanted);
        if (named) { autoPicked.current = true; pickShift(named); return; }
        // ONE open shift is the normal case at a single-outlet station, so choose
        // it for him. Several open shifts is a real choice — the chips below stay.
        if (list.length === 1) { autoPicked.current = true; pickShift(list[0]); }
      })
      .catch(()=>setOpen([]));
  }, [stationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Slips kept against this shift. Best-effort on purpose: an outlet whose
  // artifact table predates the migration, or one that has never scanned a
  // slip, must render an empty strip rather than break the close screen.
  const loadSlips = async (shiftId) => {
    if (!shiftId) { setSlips([]); return; }
    try {
      const rows = await api.get('/artifacts', { params: { entity_type: 'shift', entity_id: shiftId } });
      setSlips((Array.isArray(rows) ? rows : []).filter(r => r.kind === 'nozzle_slip'));
    } catch { setSlips([]); }
  };

  const pickShift = async (s) => {
    setBusy('pick'); setErr('');
    try {
      const [d, tk, pr, reco, dr] = await Promise.all([
        api.get(`/shifts/${s.id}`),
        api.get(`/dipstick/tanks/${stationId}`).catch(()=>[]),
        api.get(`/prices/${stationId}/current`).catch(()=>[]),
        api.get(`/reconcile/${s.id}`).catch(()=>[]),   // already-settled operators
        // Tanks that ALREADY have a closing dip stored for this shift. Without this
        // the hard-stop below fires for readings that are safely in the database —
        // and a blocking warning that cries wolf is how managers learn to click
        // past the real one.
        api.get('/dipstick', { params:{ station_id: stationId, shift_id: s.id } }).catch(()=>[]),
      ]);
      setShift(d);
      loadFaceRefs(d?.attendants || []);
      setActiveShift({ id:d.id, shift_number:d.shift_number, start_time:d.start_time, station_id:d.station_id });
      setTanks(Array.isArray(tk)?tk:[]);
      const pm = {}; (Array.isArray(pr)?pr:[]).forEach(p => { pm[p.fuel_type] = num(p.price); }); setPrices(pm);

      // Re-hydrate operators already settled server-side, so a pause/refresh/remount
      // never wipes a recorded settlement and forces the manager to re-enter it.
      const byAtt = {}; (Array.isArray(reco)?reco:[]).forEach(r => { byAtt[r.attendant_id] = r; });
      const seed = {}; const closedSeed = {};
      (d?.attendants||[]).forEach(a => {
        const r = byAtt[a.attendant_id];
        if (r && r.manager_confirmed) {
          seed[a.attendant_id] = { closings:{},
            cash:   r.cash_actual  != null ? String(r.cash_actual)  : '',
            card:   r.card_total   != null ? String(r.card_total)   : '',
            upi:    r.upi_total    != null ? String(r.upi_total)    : '',
            credit: r.credit_total != null ? String(r.credit_total) : '',
            petty:  r.petty_cash   != null ? String(r.petty_cash)   : '' };
          closedSeed[a.attendant_id] = { variance: num(r.cash_actual) - num(r.cash_expected), total_sales: num(r.total_sales), at: r.reconciled_at || null };
        } else {
          seed[a.attendant_id] = { closings:{}, cash:'', card:'', upi:'', credit:'', petty:'' };
        }
      });
      setForms(seed); setClosed(closedSeed);
      // Dip state belongs to the shift being closed — switching shift must not
      // carry a half-typed reading across.
      setDips({}); setDipVol({}); setSavedDips({}); setDipArtifact({}); setGaugeArtifact(''); setGaugeMsg('');
      // A composite scanned for one shift must not carry its camera-lock into another.
      setCompositeScanned(false);
      loadSlips(d?.id);
      const stored = {};
      (Array.isArray(dr)?dr:[]).forEach(x => { if (x.reading_type === 'closing') stored[x.tank_id] = x; });
      setShiftDips(stored);
      setStep(0);
    } catch(e){ setErr(e.response?.data?.error||e.error||tc('send.couldNotLoadShift', 'Could not load shift')); }
    setBusy('');
  };

  const attendants = shift?.attendants || [];
  const setF  = (aid, k, v) => setForms(p => ({ ...p, [aid]: { ...p[aid], [k]: v } }));
  const setCl = (aid, nid, v) => setForms(p => ({ ...p, [aid]: { ...p[aid], closings: { ...(p[aid]?.closings||{}), [nid]: v } } }));

  // The working area always holds ONE operator. When he is settled (or the shift
  // is reloaded) it moves on to the next one still open, so the manager never has
  // to hunt for where to carry on.
  useEffect(() => {
    const list = shift?.attendants || [];
    if (sel && !closed[sel] && list.some(a => a.attendant_id === sel)) return;
    const next = list.find(a => !closed[a.attendant_id]);
    setSel(next ? next.attendant_id : '');
  }, [shift, closed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live tally for one operator
  const opSales = (a) => {
    const fm = forms[a.attendant_id] || {};
    let s = 0;
    (a.nozzles||[]).forEach(nz => {
      const cl = fm.closings?.[nz.nozzle_id];
      if (cl !== '' && cl != null) {
        const ltr = num(cl) - num(nz.opening_reading);
        if (ltr > 0) s += ltr * (prices[nz.fuel_type] || 0);
      }
    });
    return +s.toFixed(2);
  };
  const opExpected = (a) => {
    const fm = forms[a.attendant_id] || {};
    const cashValue = opSales(a) - num(fm.card) - num(fm.upi) - num(fm.credit);
    return +(num(a.opening_cash) + cashValue - num(fm.petty)).toFixed(2);
  };
  const opVariance = (a) => +(num(forms[a.attendant_id]?.cash) - opExpected(a)).toFixed(2);

  const scanMeter = async (a, nozzle, file) => {
    if (!file) return;
    setScanning(nozzle.nozzle_id); setErr('');
    try {
      const b64 = await readB64(file);
      const r = await api.post('/reconcile/pos-meter', { shift_id: shift.id, nozzle_id: nozzle.nozzle_id, image_base64: b64, media_type: file.type || 'image/jpeg' });
      if (r.reading) setCl(a.attendant_id, nozzle.nozzle_id, r.reading);
      if (!r.legible) setErr(tc('send.scanUnclear', 'Nozzle {n}: scan unclear{notes} — check the reading.').replace('{n}', nozzle.nozzle_number).replace('{notes}', r.notes ? ` (${r.notes})` : ''));
    } catch (e) { setErr(e.response?.data?.error || e.error || tc('send.scanFailed', 'Scan failed')); }
    setScanning('');
  };

  // Scan the whole printed pump slip (Slip A/B) — fills the CLOSING meter for
  // every nozzle on it across ALL operators, matched by label "{pump}.{nozzle}".
  // It stays a shift-wide action (not per-operator) because the slip itself is
  // shift-wide: one print-out covers every nozzle on the pump.
  const scanSlip = async (file) => {
    if (!file || !shift) return;
    setScanning('slip'); setErr('');
    try {
      const b64 = await readB64(file);
      const r = await api.post('/reconcile/parse-slip', { shift_id: shift.id, image_base64: b64, media_type: file.type || 'image/jpeg' });
      let matched = 0; const miss = [];
      (r.nozzles || []).forEach(n => {
        if (n.cumulative_volume == null) return;
        let found = false;
        // Prefer the nozzle the SERVER resolved: it accepts both "3.1" and plain
        // "3" numbering, and deliberately resolves to nothing when several nozzles
        // share a number rather than filling the wrong fuel's meter. The label
        // comparison is only a fallback for a backend that has not deployed yet.
        attendants.forEach(a => (a.nozzles || []).forEach(nz => {
          const hit = n.nozzle_id ? nz.nozzle_id === n.nozzle_id : String(nz.nozzle_number) === n.label;
          if (hit) { setCl(a.attendant_id, nz.nozzle_id, n.cumulative_volume); matched++; found = true; }
        }));
        if (!found) miss.push(n.label || n.nozzle_no || '?');
      });
      if (!matched) setErr(r.hint || tc('send.slipNoMatch2', 'Slip read, but none of its nozzles could be matched to this outlet. Check the nozzle numbers under Settings — the slip prints {x}.').replace('{x}', (r.nozzles||[]).map(n=>n.nozzle_no).filter(Boolean).join(', ') || '—'));
      else {
        let msg = tc('send.slipFilled', 'Filled {n} closing reading(s) from the slip.').replace('{n}', matched);
        if (miss.length) msg += ' ' + tc('send.slipNoMatchSome', 'No operator nozzle for: {x}.').replace('{x}', miss.join(', '));
        if (!r.legible)  msg += ' ' + tc('send.slipVerify', '⚠ Some digits unclear — verify.');
        // See shift-start: the server's warning about an untrusted match is shown
        // verbatim on the close side too, where a wrong meter becomes money.
        if (r.hint)      msg += ' ⚠ ' + r.hint;
        setErr(msg);
      }
      // The server kept the picture against the shift — pull it back so the strip
      // below shows it immediately, not only after a reload.
      loadSlips(shift.id);
    } catch (e) { setErr(e.response?.data?.error || e.error || tc('send.slipFailed', 'Slip scan failed')); }
    setScanning('');
  };

  // Scan ONE photo holding SEVERAL pump slips at once — the server reads every slip
  // in the frame and returns each nozzle's cumulative VOLUME already matched to a
  // nozzle_id, which we drop onto that nozzle's CLOSING through the same setCl the
  // rest of the screen uses. Shift-wide, exactly like the single-slip scan, because
  // the slips are shift-wide. Complements the per-nozzle camera and the single-slip
  // scan; it does not replace either. A line with nozzle_id null could not be matched
  // (e.g. an unregistered pump serial) — it is SURFACED, never silently applied.
  const scanAllSlips = async (file) => {
    if (!file || !shift) return;
    setScanning('all-slips'); setErr('');
    try {
      const b64 = await readB64(file);
      const res = await parseSlips(shift.id, { file_base64: b64, media_type: file.type || 'image/jpeg' });
      const slips = Array.isArray(res.slips) ? res.slips : [];
      let matched = 0; const unmatched = []; const verify = [];
      slips.forEach(s => (s.lines || []).forEach(l => {
        // Not matched to one of our nozzles — surface the printed number/serial so
        // the manager can register the pump in Settings, but do not apply it.
        if (l.nozzle_id == null) { unmatched.push(l.nozzle_number || l.slip_no || '?'); return; }
        if (l.cumulative_volume == null) return;
        let found = false;
        attendants.forEach(a => (a.nozzles || []).forEach(nz => {
          if (nz.nozzle_id === l.nozzle_id) {
            setCl(a.attendant_id, nz.nozzle_id, l.cumulative_volume);
            matched++; found = true;
            // A rupee/litre swap was corrected server-side — flag it for a look
            // before this figure becomes a settled closing meter.
            if (l.swapped_amount_for_volume) verify.push(nz.nozzle_number);
          }
        }));
        // Matched to a nozzle_id that no operator on this shift is manning.
        if (!found) unmatched.push(l.nozzle_number || String(l.nozzle_id));
      }));
      // Slips whose printed serial is not a registered pump — name the serial so the
      // manager knows to add the machine in Settings.
      const unknownSerials = slips
        .filter(s => s.serial_known === false)
        .map(s => s.pump_serial || tc('send.unknownSerial','unknown serial'));

      let msg = tc('send.slipsFilled','Filled {n} closing reading(s) from {m} slip(s).')
        .replace('{n}', matched).replace('{m}', slips.length);
      if (unmatched.length)     msg += ' ' + tc('send.slipsUnmatched','Not matched: {x}.').replace('{x}', unmatched.join(', '));
      if (unknownSerials.length) msg += ' ' + tc('send.slipsUnknownSerial','⚠ Unregistered pump serial: {x} — add it under Settings.').replace('{x}', unknownSerials.join(', '));
      if (verify.length)        msg += ' ' + tc('send.slipsVerifySwap','⚠ Verify nozzle {x}: a rupee/litre swap was auto-corrected.').replace('{x}', verify.join(', '));
      if (res.legible === false) msg += ' ' + tc('send.slipsVerify','⚠ Some digits unclear — verify.');
      if (res.notes)            msg += ' ' + res.notes;
      setErr(msg);
      // From here the per-nozzle cameras are disabled until Retake / clear — the
      // reading boxes stay hand-editable, only the competing camera is turned off.
      setCompositeScanned(true);
    } catch (e) { setErr(e.response?.data?.error || e.error || tc('send.slipsFailed','Could not read the slips — enter the readings manually.')); }
    setScanning('');
  };

  const closeOperator = async (a) => {
    const fm = forms[a.attendant_id] || {};
    const nz = a.nozzles || [];
    if (!nz.length) return setErr(tc('send.noNozzlesAssignedErr', '{name} has no nozzles assigned — fix at shift start.').replace('{name}', a.attendant_name));
    const closings = nz.map(n => ({ nozzle_id: n.nozzle_id, closing_reading: fm.closings?.[n.nozzle_id] }));
    if (closings.some(c => c.closing_reading === '' || c.closing_reading == null)) return setErr(tc('send.enterClosingEveryNozzle', 'Enter a closing meter for every nozzle of {name}.').replace('{name}', a.attendant_name));
    if (fm.cash === '' || fm.cash == null) return setErr(tc('send.enterCountedCash', 'Enter counted cash for {name} (0 if none).').replace('{name}', a.attendant_name));
    setBusy('op'+a.attendant_id); setErr('');
    try {
      // The photograph rides on the settlement call itself — the backend stores it
      // and stamps check_out in the SAME transaction, so the money and the man's
      // clock can never disagree. It is optional: a dead camera must never stop an
      // operator being settled and released.
      const body = {
        shift_id: shift.id, attendant_id: a.attendant_id, closings,
        card_total: num(fm.card), upi_total: num(fm.upi), cash_actual: num(fm.cash),
        credit_total: num(fm.credit), petty_cash: num(fm.petty),
      };
      if (photo?.base64) { body.photo_base64 = photo.base64; body.photo_media_type = photo.media_type; body.face_match = faceVerdict; }
      const r = await api.post('/reconcile/manager', body);
      setClosed(p => ({ ...p, [a.attendant_id]: { variance: num(r.variance), total_sales: num(r.total_sales), at: new Date().toISOString() } }));
      setPhoto(null); setPhotoSlot(n => n + 1);   // fresh camera for the next operator
      // Pull the shift back so the settled list can show his stored photo and the
      // close time the server actually recorded. Best-effort: a failed refresh is
      // cosmetic, the settlement is already banked.
      api.get(`/shifts/${shift.id}`).then(d => { if (d) setShift(d); }).catch(()=>{});
    } catch(e){ setErr(e.response?.data?.error||e.error||tc('send.couldNotCloseOperator', 'Could not close operator')); }
    setBusy('');
  };

  const unsettled = attendants.filter(a => !closed[a.attendant_id]);
  const settled   = attendants.filter(a =>  closed[a.attendant_id]);
  const selA      = attendants.find(a => a.attendant_id === sel) || null;
  const allClosed = attendants.length > 0 && unsettled.length === 0;
  // An empty shift (opened by mistake, no operators) has nothing to reconcile —
  // allow closing it directly so it doesn't sit open as an eyesore.
  const emptyShift = !!shift && attendants.length === 0;

  // Only liquid tanks are dipped — CNG is sold by mass/pressure, never dip-measured.
  const dipTanks = tanks.filter(t => (t.fuel_type||'').toLowerCase() !== 'cng');

  // ── Gauge-screen scan (ATG / Pinelabs console photo) ──────────────────
  // The closing half of what shift-start already does for the opening stock. It
  // fills the LITRES box only, never the dip. That is deliberate: saveDip below
  // treats "dip entered" as a physical check and "litres only" as a system (ATG)
  // reading, keeping dip_cm null — which is exactly what a console reading is.
  // Nothing is written by scanning — the figures land in the boxes, and Close
  // Shift is what saves them.
  //
  // The image is downscaled here rather than through PhotoCapture: a console
  // screen full of small digits needs far more pixels (2600px) than a face does,
  // and PhotoCapture's 1400px bound would cost readings.
  const handleGaugeScan = async (file) => {
    if (!file || !shift) return;
    setGaugeBusy(true); setGaugeMsg(''); setErr('');
    try {
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
      // reading_type + shift_id file the stored screen under THIS shift's close, so
      // the closing stock figure can always be traced back to the picture it came
      // from. artifact_id may be null on a database where the DDL has not run yet.
      const res = await parseGaugeScreen({ station_id: stationId, file_base64: base64, media_type,
        shift_id: shift.id, reading_type: 'closing' });
      const artId = res.artifact_id || null;
      setGaugeArtifact(artId || '');
      const rows = Array.isArray(res.tanks) ? res.tanks : [];
      // FUEL DECIDES WHICH TANK; THE TANK NUMBER ONLY VERIFIES. The rule lives in
      // lib/gaugeMatch so this cannot drift from shift open — read the note at the
      // top of that file for why it is this way round.
      const { pairs, dropped, unplaced, ambiguous, renumbered, capacityOff } =
        matchGaugeRows(rows, dipTanks);

      pairs.forEach(([tank, r]) => {
        setDipVol(p => ({ ...p, [tank.id]: String(r.net_volume_ltrs) }));
        setDips(p => ({ ...p, [tank.id]: '' }));
        setSavedDips(p => ({ ...p, [tank.id]: false }));
        // Remember WHICH photograph produced this figure, so the Save below can
        // point the stored reading back at it. Only the tanks this scan filled.
        setDipArtifact(p => ({ ...p, [tank.id]: artId }));
      });

      const skipped = [...unplaced, ...ambiguous, ...dropped];
      setGaugeMsg(
        (pairs.length === 0
          ? tc('send.gaugeNone','Could not match any tank on that screen — enter the readings manually.')
          : tc('send.gaugeFilled','Filled {n} tank(s) from the screen. Check each figure before closing.').replace('{n}', pairs.length))
        + (skipped.length ? ' ' + tc('send.gaugeSkipped','Not matched: {list}.').replace('{list}', skipped.join(', ')) : '')
        // Advisory only — these rows ARE filled.
        + (renumbered.length ? ' ' + tc('send.gaugeRenumbered','Matched on fuel: console tank {list}. The tank numbers here do not match the console — worth correcting in Settings.')
            .replace('{list}', renumbered.map(x => `${x.console} (${x.fuel}) → Tank ${x.tank}`).join(', ')) : '')
        + (capacityOff.length ? ' ' + tc('send.gaugeCapacity','Capacity differs for {list} — filled anyway, check the tank capacity in Settings.')
            .replace('{list}', capacityOff.map(x => `Tank ${x.tank} (${x.readCap}L vs ${x.ourCap}L)`).join(', ')) : '')
      );
    } catch (e) {
      setErr(e.error || e.response?.data?.error || tc('send.gaugeFail','Could not read the screen — enter the readings manually.'));
    } finally { setGaugeBusy(false); }
  };

  // ── Closing dip ───────────────────────────────────────────────────────
  // Volume for a tank — from the DIP (a physical check) if a dip was entered, else
  // straight from the LITRES field (a reading typed off, or scanned from, the
  // ATG/HPCL system). Same distinction as shift-start, deliberately: a tank WITH a
  // calibration chart must still be saveable from litres alone, or a gauge scan
  // could not be recorded on a chart-configured tank at all.
  const tankVol = (tk) => {
    const dip = dips[tk.id], litres = dipVol[tk.id];
    const hasChart = tk.diameter_cm && tk.length_cm;
    if (dip !== '' && dip != null) {
      if (hasChart) return dipToVolume(tk.diameter_cm, tk.length_cm, markToTrueDip(dip));
      return litres !== '' && litres != null ? parseFloat(litres) : null;   // no chart → needs manual litres
    }
    return litres !== '' && litres != null ? parseFloat(litres) : null;      // litres only (system reading)
  };
  const saveDip = async (tk) => {
    const dip = dips[tk.id], litres = dipVol[tk.id];
    const hasDip    = dip !== '' && dip != null;
    const hasLitres = litres !== '' && litres != null;
    if (!hasDip && !hasLitres) return false;
    const hasChart = tk.diameter_cm && tk.length_cm;
    const vol = tankVol(tk);
    if (vol == null || !Number.isFinite(vol)) { setErr(tc('send.tankEnterVolume', 'Tank {n}: enter a volume.').replace('{n}', tk.tank_number)); return false; }
    // Dip entered → physical reading (store dip_cm). Litres only → system (ATG)
    // reading: dip_cm stays null, which is how we tell the two apart downstream.
    const dip_cm = hasDip ? (hasChart ? markToTrueDip(dip) : parseFloat(dip)) : null;
    setBusy('dip'+tk.id); setErr('');
    try {
      await api.post('/dipstick', { station_id: stationId, tank_id: tk.id, shift_id: shift.id,
        reading_type: 'closing', dip_cm, volume_ltrs: vol,
        // Optional, and ignored by a backend whose column isn't there yet.
        artifact_id: dipArtifact[tk.id] || undefined });
      setSavedDips(p => ({ ...p, [tk.id]: true }));
      // Reflect the save inline immediately (so the "last saved" line updates without a reload).
      setTanks(ts => ts.map(x => x.id === tk.id
        ? { ...x, last_dip_cm: dip_cm, last_reading: vol,
            last_reading_at: new Date().toISOString(), last_reading_type: 'closing' }
        : x));
      setBusy('');
      return true;
    } catch (e) {
      setErr(e.response?.data?.error || e.error || tc('send.couldNotSaveDip', 'Could not save dip'));
      setBusy('');
      return false;
    }
  };

  // A tank the manager has typed into (or a scan has filled) but not yet Saved.
  // Closing the shift over one of these would silently bin today's closing stock —
  // which is tomorrow's opening — so Close Shift stops and asks first.
  const isDirty    = (tk) => {
    const d = dips[tk.id], l = dipVol[tk.id];
    const typed = (d !== '' && d != null) || (l !== '' && l != null);
    return typed && !savedDips[tk.id];
  };
  // "Has a closing reading" means saved in THIS sitting or already in the database
  // for this shift — a manager who dipped, walked away and came back must not be
  // told his tanks are unread.
  const hasReading = (tk) => !!savedDips[tk.id] || !!shiftDips[tk.id];

  // Persist a tank the moment the manager leaves its box. This is what replaces
  // the per-tank Save button: he dips tank 1, walks to tank 2, and tank 1 is
  // already in — the progressive save the button gave him, without the button,
  // and without a half-walked forecourt being lost if the phone locks. Silent by
  // design (saveDip surfaces its own error banner); a failure here simply leaves
  // the row dirty, and Close Shift will try it again.
  const autoSaveDip = (tk) => {
    if (!shift || !isDirty(tk) || busy === 'dip' + tk.id) return;
    saveDip(tk);
  };

  // A TYPED READING IS A READING. Closing the shift saves whatever is in the
  // boxes and then closes — the manager is never told that the figures he just
  // entered are "not saved", which is what the per-tank Save button used to do
  // and what confused Highway into thinking the close had failed.
  //
  // The warning survives for the case it was actually written for: a tank with
  // NO closing reading at all, typed or stored. That is a real gap in the stock
  // record (today's closing is tomorrow's opening), so it still stops and asks.
  const requestCloseShift = () => {
    const missing = dipTanks.filter(tk => !isDirty(tk) && !hasReading(tk));
    if (missing.length) { setDipWarn({ missing }); return; }
    saveAndClose();
  };
  // Save everything still pending, then close. Stops on the first failure — the
  // error banner explains, and closing over a failed save is exactly the loss the
  // warning exists to prevent.
  const flushDips = async () => {
    const pending = dipTanks.filter(isDirty);
    for (const tk of pending) { const ok = await saveDip(tk); if (!ok) return false; }
    return true;
  };
  const saveAndClose = async () => {
    setDipWarn(null);
    if (await flushDips()) await closeShift();
  };

  const closeShift = async () => {
    setBusy('close'); setDipWarn(null);
    try { await api.patch(`/shifts/${shift.id}/close`, { confirm:true }); setActiveShift(null); setDone(true); }
    catch(e){
      const d = e.response?.data;
      // The server is the authority on whether every tank has been read — the
      // screen can be out of date (a second manager, another device, a reading
      // entered from the Dipstick screen). When it refuses, reopen the dialog on
      // ITS list of tanks rather than the one this page happened to compute.
      if (d?.error === 'missing_closing_dip' && Array.isArray(d.tanks) && d.tanks.length) {
        setDipWarn({ missing: d.tanks.map(t => ({ id:`srv-${t.tank_number}`, tank_number:t.tank_number })) });
      }
      // Prefer the server's sentence over its error CODE: `error` here is a
      // machine string ('missing_closing_dip', 'active_pos') and showing it to a
      // manager explains nothing.
      setErr(d?.message || d?.error || e.error || tc('send.closeFailed', 'Close failed'));
    }
    setBusy('');
  };

  const vBadge = (v) => {
    const short = v < -1, over = v > 1;
    return (
      <span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:12.5,fontWeight:700,
        color: short?'#991b1b':over?'#9a3412':'#166534'}}>
        {short && <AlertTriangle size={14}/>}{short?tc('send.short','Short'):over?tc('send.over','Over'):tc('send.tallied','Tallied')} {fmt(Math.abs(v))}
      </span>
    );
  };

  const staleShift = !!shift && hoursSince(shift.start_time) > 24;

  return (
    <AppShell>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:'0.5rem',flexWrap:'wrap'}}>
        <button onClick={()=>router.push('/dashboard')} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-3)',display:'flex',alignItems:'center',gap:4,fontSize:13}}><ArrowLeft size={15}/>{tc('send.dashboard','Dashboard')}</button>
        <ChevronRight size={14} color="var(--text-3)"/>
        <span style={{fontWeight:800,fontSize:15}}>{tc('send.endShift','End Shift')}{shift?` — ${tc('send.shiftLabel','Shift')} ${shift.shift_number}`:''}</span>
      </div>

      <div style={{display:'flex',gap:6,marginBottom:'1.25rem',flexWrap:'wrap'}}>
        {STEPS.map((s,i)=>(
          <button key={s.key} onClick={()=>{ if(!done && shift && i<=step) setStep(i); }} disabled={done || !shift}
            style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:99,fontSize:13,fontWeight:600,
              border:'1.5px solid '+(i===step?'#FF6B00':'#e5e3de'),background:i<step?'#16a34a':i===step?'#fff7ed':'#fff',
              color:i<step?'#fff':i===step?'#9a3412':'#888',cursor:shift&&i<=step?'pointer':'default'}}>
            <span style={{width:18,height:18,borderRadius:'50%',background:i<step?'rgba(255,255,255,.3)':i===step?'#FF6B00':'#e5e3de',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11}}>{i<step?<Check size={12}/>:i+1}</span>
            {tc('send.step'+s.key, s.label)}
          </button>
        ))}
      </div>

      {err && <div style={{background:'#fee2e2',color:'#991b1b',borderRadius:8,padding:'10px 12px',fontSize:13,marginBottom:12}}>{err}</div>}

      {/* SCREEN 1 — Settle attendants */}
      {step===0 && (
        <div style={{maxWidth:700}}>
          {/* Which shift — inline, not a step. Kept visible even when there is only
              one so the manager can see WHAT he is closing, and so the >24h warning
              still has somewhere to live. */}
          <div className="card" style={{marginBottom:'0.85rem',padding:'10px 12px'}}>
            <div style={{fontSize:11,fontWeight:800,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:6}}>
              {tc('send.shiftBeingClosed','Shift being closed')}
            </div>
            {open.length===0
              ? <div style={{color:'#aaa',fontSize:13}}>{tc('send.noOpenShifts','No open shifts.')}</div>
              : (<>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  {open.map(s=>{
                    const stale = hoursSince(s.start_time) > 24;
                    const on = shift?.id === s.id;
                    return (
                      <button key={s.id} onClick={()=>{ if(!on) pickShift(s); }} disabled={busy==='pick'}
                        style={{textAlign:'left',borderRadius:10,padding:'8px 12px',cursor:on?'default':'pointer',
                          border:'1.5px solid '+(on?'#FF6B00':stale?'#fca5a5':'#eef0f2'),
                          background:on?'#fff7ed':stale?'#fef2f2':'#f8fafc'}}>
                        <div style={{fontWeight:700,fontSize:13.5}}>
                          {tc('send.shiftLabel','Shift')} {s.shift_number}
                          <span style={{fontWeight:400,color:'#888',fontSize:12}}> · {fmtDate(s.date)} · {s.attendant_count} {s.attendant_count===1?tc('send.operator','operator'):tc('send.operators','operators')}</span>
                        </div>
                        <div style={{fontSize:11.5,color:stale?'#dc2626':'#888',display:'flex',alignItems:'center',gap:4,marginTop:2}}>
                          <Clock size={12}/> {tc('send.opened','opened')} {openedLabel(s.start_time)}
                          {stale && <span style={{fontWeight:800}}>· {tc('send.openOver24h','OPEN >24h')}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {!shift && <div style={{fontSize:12.5,color:'var(--text-3)',marginTop:8}}>{tc('send.pickShiftToClose','Pick the shift to close')}</div>}
                {staleShift && <div style={{fontSize:12.5,color:'#dc2626',fontWeight:700,marginTop:8}}>⚠ {tc('send.openOver24hWarn','This shift has been open more than 24 hours — check the readings before settling.')}</div>}
              </>)}
          </div>

          {shift && attendants.length===0 && (
            <div className="card" style={{color:'#aaa',fontSize:13,marginBottom:'0.85rem'}}>{tc('send.noOperatorsOnShift','No operators on this shift.')}</div>
          )}

          {shift && attendants.length>0 && (<>
            {/* One slip covers every nozzle on the pump, so this stays shift-wide. */}
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:12}}>
              <label style={{display:'inline-flex',alignItems:'center',gap:8,padding:'9px 14px',background:scanning==='slip'?'#94a3b8':'#0f766e',color:'#fff',borderRadius:8,cursor:scanning==='slip'?'default':'pointer',fontSize:13,fontWeight:600}}>
                📄 {scanning==='slip' ? tc('send.slipReading','Reading slip…') : tc('send.scanSlip','Scan pump slip → fill all closing meters')}
                <input type="file" accept="image/*" capture="environment" disabled={scanning==='slip'} style={{display:'none'}} onChange={e=>{ scanSlip(e.target.files?.[0]); e.target.value=''; }}/>
              </label>
              {/* Composite — ONE photo of SEVERAL slips fills every matched nozzle's
                  closing at once. While a composite is in force the per-nozzle
                  cameras below are disabled so they cannot overwrite it; the reading
                  boxes stay hand-editable. Retake / clear re-arms the per-nozzle
                  cameras. */}
              <label style={{display:'inline-flex',alignItems:'center',gap:8,padding:'9px 14px',background:(compositeScanned||scanning==='all-slips')?'#94a3b8':'#7c3aed',color:'#fff',borderRadius:8,cursor:(compositeScanned||scanning==='all-slips')?'default':'pointer',fontSize:13,fontWeight:600}}>
                📸 {scanning==='all-slips' ? tc('send.slipsReading','Reading slips…') : tc('send.scanAllSlips','Scan all slips (one photo)')}
                <input type="file" accept="image/*" capture="environment" disabled={compositeScanned||scanning==='all-slips'} style={{display:'none'}} onChange={e=>{ scanAllSlips(e.target.files?.[0]); e.target.value=''; }}/>
              </label>
              {compositeScanned && (
                <button type="button" onClick={()=>{ setCompositeScanned(false); setErr(''); }}
                  style={{padding:'9px 14px',background:'#fff',color:'#6d28d9',border:'1.5px solid #ddd6fe',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer'}}>
                  {tc('send.retakeSlips','Retake / clear')}
                </button>
              )}
            </div>

            {/* The slips scanned for this shift. These are the printed evidence
                behind every closing meter below — kept since the scan shipped, but
                never shown until now, so nobody could check a reading against the
                paper it came from. Read-only; the strip simply disappears on a
                shift where no slip was scanned. */}
            {slips.length>0 && (
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:12}}>
                <span style={{fontSize:12,fontWeight:700,color:'#475569'}}>
                  {tc('send.slipsOnShift','Slips scanned')} <span style={{fontWeight:400,color:'#94a3b8'}}>· {slips.length}</span>
                </span>
                {slips.map(s => (
                  <ArtifactImage key={s.id} artifactId={s.id} size={44}
                    label={`${tc('send.slipLabel','Pump slip')}${s.meta?.pump_id ? ` · ${tc('send.pumpWord','Pump')} ${s.meta.pump_id}` : ''}${s.captured_at ? ` · ${fmtWhen(s.captured_at)}` : ''}`}/>
                ))}
              </div>
            )}

            {/* THE WORKING CARD — one operator at a time. */}
            {unsettled.length>0 ? (
              <div className="card" style={{marginBottom:'0.85rem'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:10}}>
                  <div style={{fontWeight:700,fontSize:15}}>{tc('send.settleAnOperator','Settle an operator')}</div>
                  <span style={{fontSize:12,fontWeight:700,color:'#9a3412',background:'#fff7ed',borderRadius:99,padding:'2px 10px'}}>
                    {tc('send.stillOpenCount','{n} still open').replace('{n}', unsettled.length)}
                  </span>
                </div>

                {/* 1 — HIS PHOTOGRAPH FIRST. Phase 0 of facial recognition: today it
                    is proof of who was released and when; later the picture will
                    fetch the operator and the picker below becomes the fallback.
                    Keyed on photoSlot so it clears between operators — but NOT on
                    the selection, or picking the man after taking his photo (the
                    intended order) would wipe the photo. */}
                <PhotoCapture key={`op-photo-${photoSlot}`}
                  label={tc('send.photoOfOperator','Photo of the operator')}
                  hint={tc('send.photoOfOperatorHint','Taken as he hands over. Optional — a dead camera never blocks a settlement.')}
                  onCapture={onFacePhoto}
                  disabled={!!busy}
          removeLabel={tc('photo.remove', 'Remove')}/>
                {faceMsg && (
                  <div style={{marginTop:6,fontSize:12.5,lineHeight:1.45,padding:'7px 10px',borderRadius:8,
                    background: faceVerdict?.verdict === 'strong' ? '#ecfdf5'
                              : faceVerdict?.verdict === 'likely' ? '#fff7ed' : '#f8fafc',
                    color:     faceVerdict?.verdict === 'strong' ? '#065f46'
                              : faceVerdict?.verdict === 'likely' ? '#9a3412' : 'var(--text-3)'}}>
                    {faceMsg}
                  </div>
                )}

                {/* 2 — WHO HE IS. A plain list of the operators still open on this
                    shift; a settled man disappears from it, so he cannot be settled
                    twice by mistake. */}
                <div style={{marginTop:12}}>
                  <label className="label">{tc('send.operator','Operator')}</label>
                  <select style={inp} value={sel} onChange={e=>setSel(e.target.value)}>
                    <option value="">{tc('send.selectOperator','Select…')}</option>
                    {unsettled.map(a => <option key={a.attendant_id} value={a.attendant_id}>{a.attendant_name}</option>)}
                  </select>
                </div>

                {selA && (()=>{
                  const a = selA; const fm = forms[a.attendant_id]||{};
                  const sales = opSales(a), expected = opExpected(a), variance = opVariance(a);
                  return (
                    <div style={{marginTop:12,paddingTop:10,borderTop:'1px solid #eef0f2'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:8}}>
                        <div style={{fontSize:12.5,color:'#555'}}>
                          {/* Shown only when there IS a float. Outlets do not give one,
                              so shift start no longer asks and every new shift reads
                              ₹0.00 — a line that always says zero is noise the eye
                              learns to skip. Older shifts and any outlet that does hand
                              a float still show it, because it is real money and the
                              expected-cash maths below depends on it. */}
                          {Number(a.opening_cash||0) !== 0 && (
                            <>{tc('send.float','float')} <b>{fmt(a.opening_cash)}</b>{' · '}</>
                          )}
                          {(a.nozzles||[]).length} {(a.nozzles||[]).length===1?tc('send.nozzle','nozzle'):tc('send.nozzles','nozzles')}
                        </div>
                        {/* The span he is being released from. started_at is null
                            until the attendance DDL has run — say so rather than
                            print a blank. */}
                        <div style={{fontSize:12,color:'#888',display:'flex',alignItems:'center',gap:4}}>
                          <Clock size={12}/>
                          {a.started_at
                            ? tc('send.onShiftSince','on shift since {t}').replace('{t}', fmtWhen(a.started_at))
                            : tc('send.startTimeNotRecorded','start time not recorded')}
                        </div>
                      </div>

                      {/* 3 — his nozzles' closing meters */}
                      {(a.nozzles||[]).length===0
                        ? <div style={{fontSize:12.5,color:'#b45309',marginBottom:8}}>{tc('send.noNozzlesAssigned','No nozzles assigned to this operator — fix at shift start.')}</div>
                        : (a.nozzles||[]).map(nz=>(
                          <div key={nz.nozzle_id} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                            <div style={{width:150,fontSize:12.5,fontWeight:600}}>N{nz.nozzle_number} <span style={{color:'#888',fontWeight:400}}>{nz.fuel_type}</span> <span style={{color:'#aaa',fontWeight:400}}>· open {Number(nz.opening_reading||0)}</span></div>
                            <input style={{...inp,flex:1}} type="number" step="0.001" placeholder={tc('send.closingMeter','Closing meter')}
                              value={fm.closings?.[nz.nozzle_id]||''} onChange={e=>setCl(a.attendant_id,nz.nozzle_id,e.target.value)}/>
                            <label title={compositeScanned ? tc('send.cameraOffComposite','Per-nozzle camera off — a composite photo is in force. Retake / clear to use it.') : tc('send.scanTotalizer','Scan the totalizer')}
                              style={{flexShrink:0,width:38,height:34,display:'flex',alignItems:'center',justifyContent:'center',background:(compositeScanned||scanning===nz.nozzle_id)?'#94a3b8':'#475569',color:'#fff',borderRadius:8,cursor:(compositeScanned||scanning===nz.nozzle_id)?'not-allowed':'pointer',fontSize:15,opacity:compositeScanned?0.5:1}}>
                              {scanning===nz.nozzle_id?'…':'📷'}
                              <input type="file" accept="image/*" capture="environment" disabled={compositeScanned||scanning===nz.nozzle_id} style={{display:'none'}} onChange={e=>{ scanMeter(a, nz, e.target.files?.[0]); e.target.value=''; }}/>
                            </label>
                          </div>
                        ))}

                      {/* 4 — the settlement breakup */}
                      <div className="stack-mobile" style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:8,marginTop:10}}>
                        <div><label className="label">{tc('send.cash','Cash')} ₹</label><input style={inp} type="number" step="0.01" value={fm.cash||''} onChange={e=>setF(a.attendant_id,'cash',e.target.value)}/></div>
                        <div><label className="label">{tc('send.card','Card')} ₹</label><input style={inp} type="number" step="0.01" value={fm.card||''} onChange={e=>setF(a.attendant_id,'card',e.target.value)}/></div>
                        <div><label className="label">UPI ₹</label><input style={inp} type="number" step="0.01" value={fm.upi||''} onChange={e=>setF(a.attendant_id,'upi',e.target.value)}/></div>
                        <div><label className="label">{tc('send.credit','Credit')} ₹</label><input style={inp} type="number" step="0.01" value={fm.credit||''} onChange={e=>setF(a.attendant_id,'credit',e.target.value)}/></div>
                        <div><label className="label">{tc('send.pettySkim','Petty/Skim')} ₹</label><input style={inp} type="number" step="0.01" value={fm.petty||''} onChange={e=>setF(a.attendant_id,'petty',e.target.value)}/></div>
                      </div>

                      {/* 5 — live tally, 6 — close him */}
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap',marginTop:10,paddingTop:10,borderTop:'1px solid #eef0f2'}}>
                        <div style={{fontSize:12,color:'#555'}}>{tc('send.sales','Sales')} <b>{fmt(sales)}</b> · {tc('send.expectedCash','Expected cash')} <b>{fmt(expected)}</b> → {vBadge(variance)}</div>
                        <button onClick={()=>closeOperator(a)} disabled={busy==='op'+a.attendant_id}
                          style={{height:38,padding:'0 16px',background:'#16a34a',color:'#fff',border:'none',borderRadius:8,fontWeight:700,cursor:'pointer',fontSize:13}}>
                          {busy==='op'+a.attendant_id?tc('send.closingEllipsis','Closing…'):tc('send.closeOperator','Close operator')}
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="card" style={{marginBottom:'0.85rem',background:'#f0fdf4',display:'flex',alignItems:'center',gap:8}}>
                <CheckCircle size={18} color="#16a34a"/>
                <span style={{fontSize:13.5,fontWeight:700,color:'#166534'}}>{tc('send.allOperatorsSettled','Every operator on this shift is settled.')}</span>
              </div>
            )}

            {/* Settled so far — the running record, with the man's start and close
                photographs side by side. Both artifact ids may be null on a
                database where the DDL has not run; ArtifactImage draws a
                placeholder rather than an error. */}
            {settled.length>0 && (
              <div className="card" style={{marginBottom:'0.85rem'}}>
                <div style={{fontWeight:700,fontSize:14,marginBottom:6}}>
                  {tc('send.settledSoFar','Settled')} <span style={{fontWeight:400,color:'#888',fontSize:12.5}}>· {settled.length}/{attendants.length}</span>
                </div>
                {settled.map(a=>{
                  const c = closed[a.attendant_id] || {};
                  const when = a.ended_at || c.at;
                  return (
                    <div key={a.attendant_id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 0',borderTop:'1px solid #f1f5f9'}}>
                      <ArtifactImage artifactId={a.photo_start_artifact_id} size={34} label={`${a.attendant_name} — ${tc('send.atStart','at start')}`}/>
                      <ArtifactImage artifactId={a.photo_close_artifact_id} size={34} label={`${a.attendant_name} — ${tc('send.atClose','at close')}`}/>
                      <div style={{minWidth:0,flex:1}}>
                        <div style={{fontWeight:700,fontSize:13.5}}>{a.attendant_name}</div>
                        <div style={{fontSize:11.5,color:'#888'}}>{tc('send.closed','Closed')}{when?` · ${fmtWhen(when)}`:''}</div>
                      </div>
                      {vBadge(num(c.variance))}
                    </div>
                  );
                })}
              </div>
            )}
          </>)}

          {emptyShift ? (
            <button onClick={closeShift} disabled={busy==='close'}
              style={{width:'100%',height:44,marginTop:'0.25rem',background:'#dc2626',color:'#fff',border:'none',borderRadius:10,fontWeight:700,cursor:busy==='close'?'default':'pointer'}}>
              {busy==='close'?tc('send.closingEllipsis','Closing…'):tc('send.closeEmptyShift','Close empty shift (nothing to reconcile)')}
            </button>
          ) : shift ? (
            <button onClick={()=>setStep(1)} disabled={!allClosed}
              style={{width:'100%',height:44,marginTop:'0.25rem',background:allClosed?'#FF6B00':'#cbd5e1',color:'#fff',border:'none',borderRadius:10,fontWeight:700,cursor:allClosed?'pointer':'not-allowed'}}>
              {allClosed?tc('send.nextClosingDip','Next: Closing dip & close shift →'):tc('send.closeEveryOperatorFirst','Close every operator first')}
            </button>
          ) : null}
        </div>
      )}

      {/* SCREEN 2 — Closing gauge & dip, then close the shift */}
      {step===1 && shift && (
        <div className="card" style={{maxWidth:620}}>
          {done ? (
            <div style={{textAlign:'center'}}>
              <CheckCircle size={48} color="#16a34a" style={{margin:'0.5rem auto'}}/>
              <div style={{fontWeight:800,fontSize:18,marginBottom:6}}>{tc('send.shiftClosed','Shift closed')}</div>
              <div style={{fontSize:13,color:'var(--text-2)',marginBottom:'1.25rem'}}>{tc('send.shiftClosedDesc','Operators settled; cash is now in “awaiting deposit”.')}</div>
              <button onClick={()=>router.push('/dashboard')} style={{width:'100%',height:44,background:'#FF6B00',color:'#fff',border:'none',borderRadius:10,fontWeight:700,cursor:'pointer'}}>{tc('send.backToDashboard','Back to Dashboard')}</button>
            </div>
          ) : (<>
            <div style={{fontWeight:700,fontSize:15,marginBottom:'0.25rem',display:'flex',alignItems:'center',gap:6}}><Droplets size={16} color="#0ea5e9"/>{tc('send.closingDipReadings','Closing dip readings')}</div>
            <div style={{fontSize:12.5,color:'var(--text-3)',marginBottom:'1rem'}}>{tc('send.closingDipDesc','Each tank’s closing dip (4 marks/cm). This is today’s closing stock — and tomorrow’s opening.')}</div>

            {/* Photograph the gauge screen. Optional shortcut for outlets with an
                automation console; outlets that take a physical dip (e.g. IOCL)
                simply never use it and the boxes below are unchanged. */}
            {dipTanks.length>0 && (
              <div style={{marginBottom:'1rem'}}>
                <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                  <label style={{display:'inline-flex',alignItems:'center',gap:6,padding:'7px 12px',borderRadius:8,
                    border:'1px solid #cbd5e1',background:'#f8fafc',fontSize:12.5,fontWeight:600,
                    cursor:gaugeBusy?'wait':'pointer',color:'#334155'}}>
                    <ScanLine size={15}/>
                    {gaugeBusy ? tc('send.gaugeReading','Reading screen…') : tc('send.gaugeScan','Scan gauge screen')}
                    <input type="file" accept="image/*" capture="environment" style={{display:'none'}} disabled={gaugeBusy}
                      onChange={e=>{ handleGaugeScan(e.target.files?.[0]); e.target.value=''; }}/>
                  </label>
                  {gaugeArtifact && <ArtifactImage artifactId={gaugeArtifact} size={38} label={tc('send.gaugeScreen','Closing gauge screen')}/>}
                </div>
                {gaugeMsg && <div style={{fontSize:12,color:'#b45309',marginTop:6}}>{gaugeMsg}</div>}
              </div>
            )}

            {dipTanks.length===0 && <div style={{color:'#aaa',fontSize:13}}>{tc('send.noDipTanks','No dip-measured tanks configured.')}</div>}
            {dipTanks.map(tk => {
              const hasChart = tk.diameter_cm && tk.length_cm;
              const vol = tankVol(tk);
              // A dip on a charted tank OWNS the litres box — the figure is computed,
              // not typed. Otherwise the box is live, which is what lets a scanned
              // (or typed) system reading be saved on a charted tank with dip_cm null.
              const dipOwnsLitres = dips[tk.id]!=='' && dips[tk.id]!=null && hasChart;
              // ALREADY READ — usually at the handover, where one scan closed this
              // shift and became the next one's opening. Show the figure; do not ask
              // for it a second time. (Not locked when he has just saved it in this
              // sitting: that row already shows "✓ Saved" and re-rendering it as a
              // summary mid-entry would be disorienting.)
              const st = !savedDips[tk.id] && shiftDips[tk.id];
              if (st) return (
                <div key={tk.id} style={{marginBottom:12,paddingBottom:10,borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                  <div style={{width:120,fontSize:13,fontWeight:600}}>{tc('send.tank','Tank')} {tk.tank_number} <span style={{color:'#888',fontWeight:400}}>{tk.fuel_type}</span></div>
                  <div style={{fontSize:14,fontWeight:800,color:'#0f172a'}}>{fmtL(st.volume_ltrs)} L</div>
                  {st.dip_cm != null && <div style={{fontSize:12,color:'#64748b'}}>{tc('send.dipLabel','dip')} {st.dip_cm} cm</div>}
                  <span style={{fontSize:11.5,color:'#166534',background:'#dcfce7',borderRadius:99,padding:'3px 10px',fontWeight:700}}>
                    🔒 {tc('send.closingAlreadyRead','Closing already read')}
                  </span>
                </div>
              );
              return (
                <div key={tk.id} style={{marginBottom:12,paddingBottom:10,borderBottom:'1px solid #f1f5f9'}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                    <div style={{width:120,fontSize:13,fontWeight:600}}>{tc('send.tank','Tank')} {tk.tank_number} <span style={{color:'#888',fontWeight:400}}>{tk.fuel_type}</span></div>
                    <input style={{...inp,width:110}} type="number" step="0.1" placeholder={hasChart?tc('send.dipExample','dip e.g. 58.3'):tc('send.dipCm','dip cm')}
                      value={dips[tk.id]||''} onBlur={()=>autoSaveDip(tk)}
                      onChange={e=>{ setDips(p=>({...p,[tk.id]:e.target.value})); setSavedDips(p=>({...p,[tk.id]:false})); }}/>
                    <span style={{fontSize:12,color:'#94a3b8'}}>{tc('send.orWord','or')}</span>
                    <input style={{...inp,width:130,...(dipOwnsLitres?{background:'#f1f5f9',color:'#0369a1',fontWeight:600}:{})}}
                      type="number" step="0.01" placeholder={tc('send.litresSystem','litres (system)')}
                      readOnly={dipOwnsLitres}
                      value={dipOwnsLitres ? (vol!=null?fmtL(vol):'') : (dipVol[tk.id]||'')}
                      onBlur={()=>autoSaveDip(tk)}
                      onChange={e=>{ setDipVol(p=>({...p,[tk.id]:e.target.value})); setSavedDips(p=>({...p,[tk.id]:false})); }}/>
                    {/* No per-tank Save button. Close Shift writes every typed
                        reading itself; a button that must be pressed before the
                        one you actually want is a second route to the same place,
                        and it taught managers that typing was not enough. */}
                    {busy==='dip'+tk.id && <span style={{fontSize:12,color:'#64748b'}}>{tc('send.savingEllipsis','Saving…')}</span>}
                    {savedDips[tk.id] && busy!=='dip'+tk.id &&
                      <span style={{fontSize:11.5,color:'#166534',background:'#dcfce7',borderRadius:99,padding:'3px 10px',fontWeight:700}}>{tc('send.saved','✓ Saved')}</span>}
                  </div>
                  {/* Last saved reading — so a blank entry box never looks like lost data. */}
                  {tk.last_reading_at
                    ? <div style={{fontSize:11.5,color:'#475569',marginTop:5,marginLeft:130}}>
                        <span style={{color:'#16a34a',fontWeight:700}}>● {tc('send.lastSaved','Last saved')}</span>{' '}
                        {tk.last_reading_type ? `${tk.last_reading_type} ` : ''}{tc('send.dip','dip')} {tk.last_dip_cm!=null?`${tk.last_dip_cm} cm`:'—'}
                        {tk.last_reading!=null?` → ${fmtL(tk.last_reading)} L`:''} · {fmtWhen(tk.last_reading_at)}
                      </div>
                    : <div style={{fontSize:11.5,color:'#94a3b8',marginTop:5,marginLeft:130}}>{tc('send.noReadingSaved','No reading saved yet for this tank.')}</div>}
                </div>
              );
            })}

            <div style={{marginTop:'1rem',paddingTop:'0.75rem',borderTop:'1px solid #eef0f2'}}>
              <div style={{fontSize:12.5,fontWeight:700,color:'#555',marginBottom:6}}>{tc('send.operatorsSettled','Operators settled')}</div>
              {attendants.map(a=>(
                <div key={a.attendant_id} style={{display:'flex',justifyContent:'space-between',fontSize:12.5,padding:'3px 0'}}>
                  <span>{a.attendant_name}</span>{closed[a.attendant_id] ? vBadge(num(closed[a.attendant_id].variance)) : <span style={{color:'#aaa'}}>—</span>}
                </div>
              ))}
            </div>

            <button onClick={requestCloseShift} disabled={busy==='close' || !allClosed}
              style={{width:'100%',height:48,marginTop:'1rem',background:allClosed?'#dc2626':'#cbd5e1',color:'#fff',border:'none',borderRadius:10,fontWeight:800,fontSize:15,cursor:allClosed?'pointer':'not-allowed'}}>
              {busy==='close'?tc('send.closingEllipsis','Closing…'):tc('send.closeShift','Close Shift')}
            </button>
          </>)}
        </div>
      )}

      {/* MISSING closing dip. A typed figure is no longer a reason to stop — Close
          Shift saves it. This fires only for a tank with no closing reading at all.
          There is NO "close anyway": the server refuses that close outright
          (missing_closing_dip), so offering the button here would only produce a
          409 the manager cannot act on. The dialog now tells him what to go and
          read instead of asking him to choose. */}
      {dipWarn && (
        <div role="presentation" onClick={()=>setDipWarn(null)}
          style={{position:'fixed',inset:0,background:'rgba(15,23,42,.55)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
          <div role="presentation" onClick={e=>e.stopPropagation()} className="card" style={{maxWidth:430,width:'100%'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
              <AlertTriangle size={18} color="#b45309"/>
              <span style={{fontWeight:800,fontSize:15}}>{tc('send.dipWarnTitleMissing','Closing dip missing')}</span>
            </div>
            <div style={{fontSize:13,color:'#555',marginBottom:8}}>
              {tc('send.dipWarnMissing','No closing reading yet: {list}.').replace('{list}', dipWarn.missing.map(tk=>`${tc('send.tank','Tank')} ${tk.tank_number}`).join(', '))}
            </div>
            <div style={{fontSize:12.5,color:'var(--text-3)',marginBottom:12}}>{tc('send.dipWarnWhyBlocking','This is today’s closing stock and tomorrow’s opening — the next shift starts from it. Read these tanks and enter them here; the shift cannot close without them.')}</div>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              {/* Anything typed on the OTHER tanks is saved on blur already, so
                  going back loses nothing. */}
              <button onClick={()=>setDipWarn(null)} style={{flex:1,minWidth:110,height:40,background:'#dc2626',color:'#fff',border:'none',borderRadius:8,fontWeight:700,fontSize:13,cursor:'pointer'}}>
                {tc('send.dipWarnEnterThem','Enter the readings')}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
