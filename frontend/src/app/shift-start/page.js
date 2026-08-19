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
import api, { parseGaugeScreen, recordDipstick, getLatestArtifacts, parseSlips } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { markToTrueDip, dipToVolume } from '../../lib/calibration';
import { matchGaugeRows } from '../../lib/gaugeMatch';
import { describe as describeFace, bestMatch, preload as preloadFace } from '../../lib/face';

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

  // ── THE HANDOVER READING ──────────────────────────────────────────────
  // The shift still running when the manager arrives to start the next one, and the
  // closings already recorded against it.
  //
  // 🔴 ONE SCAN, ONE READING. At a handover the manager walks up and reads the gauge
  // ONCE. The system used to ask for that same measurement twice — as this shift's
  // OPENING here, and as the outgoing shift's CLOSING over on Shift End — and the
  // second ask is the one that gets skipped. Highway and Adhoc Highway recorded
  // eight and six opening dips over 02–04 Aug and not one closing, so those outlets
  // had no wet-stock variance at all for three days. Nothing was broken; they were
  // simply asked for the same number twice and did it once.
  //
  // So when a shift is still open, the reading taken here IS that shift's closing,
  // written against it — and the carry-forward rule then makes it this shift's
  // opening, server-side, exactly as it does for any other close. One reading, one
  // record, one number, and the boundary cannot drift because there is no second
  // figure for it to drift from.
  const [outgoing, setOutgoing] = useState(null);
  const [outClosings, setOutClosings] = useState({});   // tank_id -> closing row on `outgoing`

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
      // The screen photo files against the shift the READING belongs to. At a
      // handover that is the shift still running — the photo is the evidence for its
      // closing — and no new shift need exist yet. Otherwise it is the shift being
      // opened, so create it first. A failure must not lose the photograph, so the
      // scan still runs unfiled rather than aborting.
      let shiftId = outgoing ? outgoing.id : (shift?.id || null);
      if (!outgoing) {
        try { shiftId = (await ensureShift()).id; } catch { /* file it later; read the screen now */ }
      }

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
        shift_id: shiftId, reading_type: outgoing ? 'closing' : 'opening',
      });
      const rows = Array.isArray(res.tanks) ? res.tanks : [];
      // FUEL DECIDES WHICH TANK; THE TANK NUMBER ONLY VERIFIES. The rule lives in
      // lib/gaugeMatch so shift close cannot drift from shift open — read the note
      // at the top of that file for why it is this way round.
      //
      // A CARRIED TANK IS NOT A CANDIDATE. Its opening is the last close and the row
      // is rendered locked, so letting a photo write to it would quietly overturn
      // the one control that stops a shift boundary drifting — and the manager would
      // see a locked green row while it happened. Offer only the tanks he can
      // actually enter, and tell him the rest were left alone.
      // A tank already read at this handover is not a candidate either — its closing
      // is recorded and a second photo would only re-open the same question.
      const openTanks  = dipTanks.filter(t => !carriedDips[t.id] && !outClosings[t.id]);
      const heldByRule = dipTanks.filter(t =>  carriedDips[t.id] || outClosings[t.id]).map(t => t.tank_number);
      const { pairs, dropped, unplaced, ambiguous, renumbered, capacityOff } =
        matchGaugeRows(rows, openTanks);

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

      const skipped = [...unplaced, ...ambiguous, ...dropped];
      setGaugeMsg(
        (pairs.length === 0
          ? tc('sstart.gaugeNone','Could not match any tank on that screen — enter the readings manually.')
          : tc('sstart.gaugeFilled','Filled {n} tank(s) from the screen. Check each figure, then Save.').replace('{n}', pairs.length))
        + (skipped.length ? ' ' + tc('sstart.gaugeSkipped','Not matched: {list}.').replace('{list}', skipped.join(', ')) : '')
        // Not an error and not a failure to match — the rule holds these.
        + (heldByRule.length ? ' ' + tc('sstart.gaugeCarriedHeld','Tank {list} kept its carried opening from the last close — a photo cannot change it.')
            .replace('{list}', heldByRule.join(', ')) : '')
        // Advisory only — these rows ARE filled. The note tells the manager the
        // Settings numbering has slipped, without standing between him and the shift.
        + (renumbered.length ? ' ' + tc('sstart.gaugeRenumbered','Matched on fuel: console tank {list}. The tank numbers here do not match the console — worth correcting in Settings.')
            .replace('{list}', renumbered.map(x => `${x.console} (${x.fuel}) → Tank ${x.tank}`).join(', ')) : '')
        + (capacityOff.length ? ' ' + tc('sstart.gaugeCapacity','Capacity differs for {list} — filled anyway, check the tank capacity in Settings.')
            .replace('{list}', capacityOff.map(x => `Tank ${x.tank} (${x.readCap}L vs ${x.ourCap}L)`).join(', ')) : '')
      );
    } catch (e) {
      setErr(e.error || e.response?.data?.error || tc('sstart.gaugeFail','Could not read the screen — enter the readings manually.'));
    } finally { setGaugeBusy(false); }
  };

  // Screen 2 — attendant assignment
  const [opAttendant, setOpAttendant] = useState('');
  const [opPhoto, setOpPhoto] = useState(null);     // { base64, media_type } | null
  // PHASE 1 OF FACIAL RECOGNITION. The enrolment descriptors for this outlet's
  // attendants (user_id -> 128 numbers), and the verdict on the face just taken.
  // Advisory ONLY, exactly like every other scan in Pumpini: it pre-selects the
  // picker and says why, and the manager confirms or overrides. It never assigns.
  const [faceRefs, setFaceRefs] = useState({});
  const [faceMsg, setFaceMsg]   = useState('');
  const [faceVerdict, setFaceVerdict] = useState(null);

  // Pull each attendant's enrolment descriptor. latestForMany already returns meta
  // and deliberately omits the image bytes, so this is ~1 kB a head, not a photo.
  const loadFaceRefs = async (staff) => {
    const ids = (staff||[]).map(x=>x.id).filter(Boolean);
    if (!ids.length) return;
    try {
      const m = await getLatestArtifacts('user', ids, 'attendant_photo');
      const refs = {};
      Object.entries(m||{}).forEach(([uid,row]) => {
        const d = row?.meta?.descriptor;
        if (Array.isArray(d) && d.length === 128) refs[uid] = d;
      });
      setFaceRefs(refs);
    } catch { /* no suggestion is a fine outcome; the picker is right there */ }
  };

  // The photograph is taken, so read it and PROPOSE a name. Everything about this
  // is advisory: 'strong' and 'likely' pre-select the picker and say which it was,
  // 'unsure' names the closest man WITHOUT selecting him, and every failure path
  // (no model, no face, two faces, nobody enrolled) leaves the picker untouched.
  // The manager is obliged to verify either way — same policy as every scan here.
  const onFacePhoto = async (shot) => {
    setOpPhoto(shot);
    setFaceMsg(''); setFaceVerdict(null);
    if (!shot?.base64) return;
    const candidates = users
      .filter(u => !assignedIds.has(u.id) && faceRefs[u.id])
      .map(u => ({ user_id: u.id, name: u.name, descriptor: faceRefs[u.id] }));
    if (!candidates.length) {
      setFaceMsg(tc('sstart.faceNoRefs','No reference photos on file yet — add them under Add Attendant and the camera will start naming him.'));
      return;
    }
    setFaceMsg(tc('sstart.faceReading','Reading the face…'));
    const { descriptor, error } = await describeFace(
      `data:${shot.media_type || 'image/jpeg'};base64,${shot.base64}`);
    if (error || !descriptor) {
      const why = {
        'no-face':    tc('sstart.faceNone','No face found in that photo — pick him from the list.'),
        'many-faces': tc('sstart.faceMany','More than one face in frame — pick him from the list.'),
      }[error] || tc('sstart.faceUnread','Could not read the face — pick him from the list.');
      setFaceMsg(why);
      return;
    }
    const m = bestMatch(descriptor, candidates);
    if (!m) { setFaceMsg(''); return; }
    setFaceVerdict(m);
    if (m.verdict === 'strong' || m.verdict === 'likely') {
      setOpAttendant(m.user_id);
      setFaceMsg((m.verdict === 'strong'
        ? tc('sstart.faceStrong','This looks like {name} — selected below. Check it before you start him.')
        : tc('sstart.faceLikely','This is probably {name} — selected below. Worth a second look.')
      ).replace('{name}', m.name));
    } else {
      setFaceMsg(tc('sstart.faceUnsure','Not sure who this is — closest is {name}. Pick him from the list.')
        .replace('{name}', m.name));
    }
  };
  const [nozPick, setNozPick] = useState({});       // nozzle_id -> { selected, opening }
  const [openings, setOpenings] = useState({});     // nozzle_id -> the prior close
  // nozzle_id -> 'carried' | 'pending' | 'entered'. THE OPENING IS THE LAST CLOSE
  // (owner rule, 01-Aug): where one exists the server uses it whatever this screen
  // sends, so the box is shown READ-ONLY rather than as an editable field whose value
  // is ignored. The other two both open the box, and the difference between them is
  // what the manager is told:
  //   'entered' — no prior leg at all: a new nozzle or the very first shift.
  //   'pending' — the shift before this one has the nozzle and has not been settled,
  //               so its closing does not exist yet. Calling that "a new nozzle" is
  //               how a manager learns to ignore the warning, so it says which shift.
  const [openSrc, setOpenSrc] = useState({});
  const [openPending, setOpenPending] = useState({}); // nozzle_id -> the unsettled shift
  const [scanning, setScanning] = useState('');
  // A composite "scan all slips" photo has been read this session. While true the
  // per-nozzle totalizer cameras are DISABLED so the two capture paths cannot fight
  // over the same opening box — but the reading fields stay hand-editable, and the
  // "Retake / clear" affordance flips this back to re-enable the per-nozzle cameras.
  const [compositeScanned, setCompositeScanned] = useState(false);
  // PhotoCapture holds its own preview; remounting it is the only way to clear that
  // preview after a successful Start, so the next attendant never inherits a face.
  const [formKey, setFormKey] = useState(0);

  const refreshOpen = () => api.get('/shifts', { params:{ station_id: stationId, status:'open' } })
    .then(os => setOpenShifts(Array.isArray(os)?os:[])).catch(()=>{});

  const refreshShift = async (id) => {
    const d = await api.get(`/shifts/${id}`);
    setShift(d); setAttendants(d?.attendants || []);
    const ops = await api.get(`/shifts/${id}/nozzle-openings`).catch(()=>[]);
    const map = {}; const src = {}; const pend = {};
    (Array.isArray(ops)?ops:[]).forEach(o => {
      if (o.suggested_opening != null) map[o.nozzle_id] = o.suggested_opening;
      src[o.nozzle_id] = o.source || (o.suggested_opening != null ? 'carried' : 'entered');
      if (o.pending_on) pend[o.nozzle_id] = o.pending_on;
    });
    setOpenings(map); setOpenSrc(src); setOpenPending(pend);

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

  // Fetch the face weights in the background as the screen opens, so the first
  // photograph does not wait on 6.5 MB. Silent on failure — describe() re-tries.
  useEffect(() => { preloadFace(); }, []);

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
      setDefs(defList);
      const staff = (Array.isArray(u)?u:[]).filter(x=>x.is_active!==false);
      setUsers(staff);
      // The reference faces, in ONE request, and deliberately AFTER the staff list
      // rather than joined into it: /users?role=attendant also feeds this picker and
      // must not grow a dependency on the artifact table. A failure here costs the
      // suggestion, never the screen.
      loadFaceRefs(staff);
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
        return;
      }

      // A FRESH START WITH A SHIFT STILL RUNNING — the handover. Whatever he reads
      // off the gauge now closes THAT shift; the server then carries it into this
      // one's opening. See the note on `outgoing` above for why this is one reading
      // and not two. Only here: resuming his own shift (the two branches above) is
      // not a handover, and its dips are already settled.
      const handover = openList
        .slice()
        .sort((a, b) => new Date(b.start_time) - new Date(a.start_time))[0] || null;
      if (handover) {
        setOutgoing(handover);
        // What it has ALREADY had closed — if he did Shift End first, the reading
        // exists and this screen must show it, not ask for it again.
        api.get('/dipstick', { params:{ station_id: stationId, shift_id: handover.id } })
          .then(rows => {
            const done = {};
            (Array.isArray(rows)?rows:[]).forEach(x => { if (x.reading_type === 'closing') done[x.tank_id] = x; });
            setOutClosings(done);
            setSavedDips(p => { const n = { ...p }; Object.keys(done).forEach(k => { n[k] = true; }); return n; });
          })
          .catch(()=>{ /* no closings visible → the boxes ask, which is the safe default */ });
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
      // WHERE THIS READING GOES. With a shift still running it is that shift's
      // CLOSING — one physical measurement, filed once, and the server's
      // carry-forward turns it into this shift's opening. Note it does NOT need the
      // new shift to exist, so no shift is created just to record it.
      //
      // With nothing running it is a genuine opening: the outlet's first shift, or
      // one started after the previous was properly closed and its carry already
      // taken. Then the reading belongs to the shift being opened, as before.
      const asClosing = !!outgoing && !outClosings[tank.id];
      const sid = asClosing ? outgoing.id : (shiftId || (await ensureShift()).id);
      const type = asClosing ? 'closing' : 'opening';
      await recordDipstick({
        station_id: stationId, tank_id: tank.id, shift_id: sid,
        reading_type: type, dip_cm, volume_ltrs: vol,
        artifact_id: dipArtifact[tank.id] || null,
      });
      setSavedDips(p => ({ ...p, [tank.id]: true }));
      if (asClosing) {
        setOutClosings(p => ({ ...p, [tank.id]: { tank_id: tank.id, dip_cm, volume_ltrs: vol } }));
      }
      // Reflect the save inline immediately (so the "last saved" line updates without a reload).
      setTanks(ts => ts.map(t => t.id === tank.id
        ? { ...t, last_dip_cm: dip_cm, last_reading: vol,
            last_reading_at: new Date().toISOString(), last_reading_type: type }
        : t));
      return true;
    } catch (e) { setErr(e.response?.data?.error || e.error || tc('sstart.errSaveDip','Could not save dip')); return false; }
  };


  // Save whatever is typed but not yet saved before leaving the screen — a figure
  // sitting in a box the manager thought he had entered is the same as no opening
  // stock at all, and he only finds out at reconciliation.
  const flushDips = async (shiftId) => {
    for (const tk of dipTanks) {
      // A tank carried from the last close is NOT writable here, whatever ended up
      // in state. The screen renders it locked, so anything that got in did so
      // without the manager seeing it — which is precisely the drift the
      // carry-forward rule exists to stop. Belt and braces with the scan filter.
      if (carriedDips[tk.id]) continue;
      // Already closed on the outgoing shift — the one reading is taken.
      if (outClosings[tk.id]) continue;
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
      // DIPS FIRST AT A HANDOVER. They close the shift that is still running and do
      // not need this one to exist; writing them before it is created means the
      // server carries them into the opening as the shift is opened, rather than
      // opening it empty and back-filling a moment later. Both orders are correct —
      // the back-fill exists precisely because the manager may open first — but this
      // one puts the carried figure on screen straight away.
      //
      // The two paths are kept apart rather than flushing twice: flushDips reads
      // savedDips/outClosings from this render, so a second call in the same tick
      // would still see them empty and re-post every tank.
      if (outgoing) {
        if (!await flushDips(null)) return;
        const s = await ensureShift();
        await refreshShift(s.id).catch(()=>{ /* the next screen still opens */ });
      } else {
        const s = await ensureShift();
        if (!await flushDips(s.id)) return;
      }
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
      const r = await api.post('/reconcile/pos-meter', { shift_id: shift.id, nozzle_id: nozzle.id, image_base64: b64, media_type: file.type || 'image/jpeg' });
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
        if (openSrc[noz.id] === 'carried' && openings[noz.id] != null) {
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
      // The server's hint names the serial and the screen that fixes it, so prefer
      // it over the generic wording whenever it is present.
      if (!matched) setErr(r.hint || tc('sstart.slipNoMatch','Slip read, but no nozzle matched. Label nozzles as pump.nozzle (e.g. {ex}).').replace('{ex}', `${r.pump_id||'1'}.1`));
      else {
        let msg = tc('sstart.slipTicked','Ticked {n} nozzle(s) from the slip.').replace('{n}', matched);
        if (miss.length)  msg += ' ' + tc('sstart.slipNoMatchSome','No app nozzle for: {x}.').replace('{x}', miss.join(', '));
        if (locked.length) msg += ' ' + tc('sstart.slipDisagrees','⚠ The slip disagrees with the last close for {x}. The last close stands — report this.').replace('{x}', locked.join(', '));
        if (!r.legible)   msg += ' ' + tc('sstart.slipVerify','⚠ Some digits unclear — verify.');
        // The server's own warning — chiefly an unrecognised pump serial, which
        // means these readings may have been matched on the pump number the slip
        // prints rather than on the machine's identity. Shown verbatim: it names
        // the serial and the screen that fixes it, which no client wording can.
        if (r.hint)       msg += ' ⚠ ' + r.hint;
        setErr(msg);
      }
    } catch (e) { setErr(e.response?.data?.error || e.error || tc('sstart.slipFailed','Slip scan failed')); }
    setScanning('');
  };

  // Scan ONE photo holding SEVERAL pump slips at once — the server reads every slip
  // in the frame and returns each nozzle's cumulative VOLUME already matched to a
  // nozzle_id, which we drop onto that nozzle's OPENING through the same pickNoz the
  // rest of the screen uses. Complements the per-nozzle camera and the single-slip
  // scan; it does not replace either. A line with nozzle_id null could not be matched
  // (e.g. an unregistered pump serial) — it is SURFACED, never silently applied.
  const scanAllSlips = async (file) => {
    if (!file || !shift) return;
    setScanning('all-slips'); setErr('');
    try {
      const b64 = await readB64(file);
      const res = await parseSlips(shift.id, { file_base64: b64, media_type: file.type || 'image/jpeg' });
      const slips = Array.isArray(res.slips) ? res.slips : [];
      let matched = 0; const unmatched = []; const verify = []; const locked = [];
      slips.forEach(s => (s.lines || []).forEach(l => {
        // Not matched to one of our nozzles — surface the printed number/serial so
        // the manager can register the pump in Settings, but do not apply it.
        if (l.nozzle_id == null) { unmatched.push(l.nozzle_number || l.slip_no || '?'); return; }
        const noz = nozzles.find(x => x.id === l.nozzle_id);
        if (!noz) { unmatched.push(l.nozzle_number || String(l.nozzle_id)); return; }
        if (l.cumulative_volume == null) return;
        // A nozzle whose opening is carried from the last close is TICKED but its
        // figure is left alone — the server uses the carried close regardless, and
        // writing the slip's number in would falsely say the reading was accepted.
        // Same rule as scanSlip; a real disagreement is a discrepancy to report.
        if (openSrc[noz.id] === 'carried' && openings[noz.id] != null) {
          pickNoz(noz.id, { selected: true });
          if (Math.abs(Number(l.cumulative_volume) - Number(openings[noz.id])) > 1) {
            locked.push(`${noz.nozzle_number} (${tc('sstart.slipSays','slip')} ${l.cumulative_volume} vs ${openings[noz.id]})`);
          }
          matched++;
          return;
        }
        pickNoz(noz.id, { selected: true, opening: l.cumulative_volume });
        matched++;
        // A rupee/litre swap was corrected server-side for this line — flag it so
        // the manager eyeballs the number before it becomes an opening.
        if (l.swapped_amount_for_volume) verify.push(noz.nozzle_number);
      }));
      // Slips whose printed serial is not a registered pump — name the serial so the
      // manager knows to add the machine in Settings.
      const unknownSerials = slips
        .filter(s => s.serial_known === false)
        .map(s => s.pump_serial || tc('sstart.unknownSerial','unknown serial'));

      let msg = tc('sstart.slipsFilled','Filled {n} nozzle(s) from {m} slip(s).')
        .replace('{n}', matched).replace('{m}', slips.length);
      if (unmatched.length)     msg += ' ' + tc('sstart.slipsUnmatched','Not matched: {x}.').replace('{x}', unmatched.join(', '));
      if (unknownSerials.length) msg += ' ' + tc('sstart.slipsUnknownSerial','⚠ Unregistered pump serial: {x} — add it under Settings.').replace('{x}', unknownSerials.join(', '));
      if (verify.length)        msg += ' ' + tc('sstart.slipsVerifySwap','⚠ Verify nozzle {x}: a rupee/litre swap was auto-corrected.').replace('{x}', verify.join(', '));
      if (locked.length)        msg += ' ' + tc('sstart.slipsDisagrees','⚠ The slip disagrees with the last close for {x}. The last close stands — report this.').replace('{x}', locked.join(', '));
      if (res.legible === false) msg += ' ' + tc('sstart.slipsVerify','⚠ Some digits unclear — verify.');
      if (res.notes)            msg += ' ' + res.notes;
      setErr(msg);
      // From here the per-nozzle cameras are disabled until Retake / clear — the
      // reading boxes stay hand-editable, only the competing camera is turned off.
      setCompositeScanned(true);
    } catch (e) { setErr(e.response?.data?.error || e.error || tc('sstart.slipsFailed','Could not read the slips — enter the readings manually.')); }
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
        face_match: faceVerdict,
      });
      setOpAttendant(''); setOpPhoto(null); setNozPick({}); setFormKey(k => k + 1);
      setFaceMsg(''); setFaceVerdict(null);
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
          <div style={{fontWeight:700,fontSize:15,marginBottom:'0.25rem',display:'flex',alignItems:'center',gap:6}}><Droplets size={16} color="#0ea5e9"/>
            {outgoing ? tc('sstart.handoverDipReadings','Handover dip readings') : tc('sstart.openingDipReadings','Opening dip readings')}
          </div>
          <div style={{fontSize:12.5,color:'var(--text-3)',marginBottom:'1rem'}}>
            {outgoing
              ? tc('sstart.dipHelpHandover','Read the gauge ONCE. This reading closes Shift {n} — the shift still running — and becomes this shift’s opening automatically. You will not be asked for it again at shift close.').replace('{n}', outgoing.shift_number)
              : tc('sstart.dipHelpCarried','The opening stock is whatever the last shift closed at — it is carried across automatically so no litre can go missing between two shifts. You only enter a reading for a tank that has no previous close.')}
          </div>
          {outgoing && (
            <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:9,padding:'9px 11px',marginBottom:'1rem',fontSize:12,color:'#9a3412'}}>
              {tc('sstart.handoverBanner','Closing Shift {n} of {d} as you open this one.')
                .replace('{n}', outgoing.shift_number).replace('{d}', fmtDay(outgoing.date))}
            </div>
          )}

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
            // Already read at this handover — the closing is on the outgoing shift
            // and the carry will bring it here. Locked for the same reason as a
            // carried tank: asking twice is what lost the closings in the first place.
            const oc = outClosings[tk.id];
            if (oc && !carriedDips[tk.id]) return (
              <div key={tk.id} style={{marginBottom:10,paddingBottom:10,borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                <div style={{width:120,fontSize:13,fontWeight:600}}>{tc('sstart.tank','Tank')} {tk.tank_number} <span style={{color:'#888',fontWeight:400}}>{tk.fuel_type}</span></div>
                <div style={{fontSize:14,fontWeight:800,color:'#0f172a'}}>{fmtL(oc.volume_ltrs)} L</div>
                {oc.dip_cm != null && <div style={{fontSize:12,color:'#64748b'}}>{tc('sstart.dipLabel','dip')} {oc.dip_cm} cm</div>}
                <span style={{fontSize:11.5,color:'#9a3412',background:'#fff7ed',borderRadius:99,padding:'3px 10px',fontWeight:700}}>
                  🔒 {tc('sstart.closedAndCarries','Closes Shift {n} · carries to this opening').replace('{n}', outgoing?.shift_number ?? '')}
                </span>
              </div>
            );
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
                  that swap a deletion rather than a redesign. PHASE 1 IS NOW LIVE:
                  the picture proposes the name below and the picker confirms or
                  overrides it. Advisory only — it never assigns on its own. */}
              <div>
                <label className="label">{tc('sstart.attendantPhoto','Photo of the attendant')}</label>
                <PhotoCapture key={formKey}
                  label={tc('sstart.takeAttendantPhoto','Take his photo')}
                  hint={tc('sstart.attendantPhotoHint','Taken as he starts. In time this photo will identify him on its own.')}
                  disabled={busy}
                  onCapture={onFacePhoto}
          removeLabel={tc('photo.remove', 'Remove')}/>
                {/* What the face said. Never a blocker and never an error banner —
                    a suggestion the manager is expected to check. Green for a
                    confident read, amber for a guess, grey for "I could not tell",
                    so the three never read alike at a glance. */}
                {faceMsg && (
                  <div style={{marginTop:6,fontSize:12.5,lineHeight:1.45,padding:'7px 10px',borderRadius:8,
                    background: faceVerdict?.verdict === 'strong' ? '#ecfdf5'
                              : faceVerdict?.verdict === 'likely' ? '#fff7ed' : '#f8fafc',
                    color:     faceVerdict?.verdict === 'strong' ? '#065f46'
                              : faceVerdict?.verdict === 'likely' ? '#9a3412' : 'var(--text-3)'}}>
                    {faceMsg}
                  </div>
                )}
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
                {/* Composite — ONE photo of SEVERAL slips fills every matched
                    nozzle's opening at once. While a composite is in force the
                    per-nozzle cameras below are disabled so they cannot overwrite
                    it; the reading boxes stay hand-editable. Retake / clear re-arms
                    the per-nozzle cameras. */}
                <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:8}}>
                  <label style={{display:'inline-flex',alignItems:'center',gap:8,padding:'8px 12px',background:(compositeScanned||scanning==='all-slips')?'#94a3b8':'#7c3aed',color:'#fff',borderRadius:8,cursor:(compositeScanned||scanning==='all-slips')?'default':'pointer',fontSize:13,fontWeight:600}}>
                    📸 {scanning==='all-slips' ? tc('sstart.slipsReading','Reading slips…') : tc('sstart.scanAllSlips','Scan all slips (one photo)')}
                    <input type="file" accept="image/*" capture="environment" disabled={compositeScanned||scanning==='all-slips'} style={{display:'none'}} onChange={e=>{ scanAllSlips(e.target.files?.[0]); e.target.value=''; }}/>
                  </label>
                  {compositeScanned && (
                    <button type="button" onClick={()=>{ setCompositeScanned(false); setErr(''); }}
                      style={{padding:'8px 12px',background:'#fff',color:'#6d28d9',border:'1.5px solid #ddd6fe',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer'}}>
                      {tc('sstart.retakeSlips','Retake / clear')}
                    </button>
                  )}
                </div>
                {availNozzles.length===0 && <div style={{fontSize:12.5,color:'#aaa'}}>{tc('sstart.allNozzlesAssigned','All nozzles are already assigned.')}</div>}
                {availNozzles.map(n=>{
                  const pick = nozPick[n.id]; const sel = !!pick?.selected;
                  const sug = openings[n.id];
                  // Carried = the last close, and the server will use it regardless.
                  const carried = openSrc[n.id] === 'carried' && sug != null;
                  // Not carried because the shift before this one has not been settled
                  // yet — a different thing from a nozzle that has never run.
                  const pendingOn = !carried && openSrc[n.id] === 'pending' ? openPending[n.id] : null;
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
                            <label title={compositeScanned ? tc('sstart.cameraOffComposite','Per-nozzle camera off — a composite photo is in force. Retake / clear to use it.') : tc('sstart.scanTotalizer','Scan the totalizer')}
                              style={{flexShrink:0,width:40,height:36,display:'flex',alignItems:'center',justifyContent:'center',background:(compositeScanned||scanning===n.id)?'#94a3b8':'#475569',color:'#fff',borderRadius:8,cursor:(compositeScanned||scanning===n.id)?'not-allowed':'pointer',fontSize:16,opacity:compositeScanned?0.5:1}}>
                              {scanning===n.id?'…':'📷'}
                              <input type="file" accept="image/*" capture="environment" disabled={compositeScanned||scanning===n.id} style={{display:'none'}} onChange={e=>{ scanMeter(n, e.target.files?.[0]); e.target.value=''; }}/>
                            </label>
                          )}
                        </div>
                      )}
                      {sel && carried && (
                        <div style={{fontSize:11,color:'#475569',marginTop:4}}>
                          🔒 {tc('sstart.carriedFromClose','Carried from the last close — the opening must equal it, so there is no gap between shifts.')}
                        </div>
                      )}
                      {sel && pendingOn && (
                        <div style={{fontSize:11,color:'#b45309',marginTop:4}}>
                          ⚠ {tc('sstart.priorShiftUnsettled','Shift {n} has this nozzle and has not been settled, so there is no close to carry yet — read the meter and enter it. Settle that shift at the same figure.')
                                .replace('{n}', pendingOn.shift_number ?? '—')}
                        </div>
                      )}
                      {sel && !carried && !pendingOn && (
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
