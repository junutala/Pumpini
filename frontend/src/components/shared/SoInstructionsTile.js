'use client';

// SO Instructions — the VAWE → Pumpini operational-task tile.
//
// A Sales Officer pushes tasks from VAWE; each outlet gets an interaction. This
// tile surfaces them on the manager's dashboard (and read-only on the owner's
// group view). The manager sets a commit-by date, uploads proof, and marks the
// task complete. Two tabs: Pending (actionable) and Completed (kept as the
// manager's record/proof — the API returns recently-closed items too). All
// manager-facing strings go through tc() with Telugu in te.json.

import { useState, useEffect, useCallback, useRef } from 'react';
import { ClipboardList, CalendarClock, Upload, CheckCircle2, X, Paperclip, AlertTriangle, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../lib/auth';
import {
  getVaweInteractions, commitVaweInteraction, completeVaweInteraction,
  uploadVaweArtifact, getVaweArtifact,
} from '../../lib/api';

const IST = { timeZone: 'Asia/Kolkata' };
const fmt = (ts) => (ts ? new Date(ts).toLocaleDateString('en-IN', { ...IST, day: '2-digit', month: 'short' }) : '—');
// Date + time in en-IN / IST (never a raw ISO). Used for the operative deadline.
const fmtDT = (ts) => (ts ? new Date(ts).toLocaleString('en-IN', { ...IST, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const ms = (ts) => (ts ? new Date(ts).getTime() : null);
// Pre-fill / min for <input type="datetime-local"> (local 'YYYY-MM-DDTHH:mm').
const toLocalInput = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Flag/badge for a row. Returns an i18n key + English fallback so the label is
// translated at render (module scope has no hook). CLOSED → Done, UNLESS it was
// closed without proof — which only happens when VAWE (the SO) withdrew the
// task, since completing here is always proof-gated. That reads as "Withdrawn".
function flagOf(it) {
  if (it.status === 'CLOSED') {
    return it.has_artifact
      ? { cls: 'badge-success', key: 'vawe.flagDone', en: 'Done' }
      : { cls: 'badge-gray', key: 'vawe.flagWithdrawn', en: 'Withdrawn' };
  }
  const now = Date.now();
  const committed = ms(it.committed_date);
  const deadline = committed ?? ms(it.desired_by);
  if (deadline && deadline < now) return { cls: 'badge-danger', key: 'vawe.flagOverdue', en: 'Overdue' };
  const soft = ms(it.desired_by);
  if (committed && soft && committed > soft) return { cls: 'badge-warning', key: 'vawe.flagRevised', en: 'Revised' };
  if (committed) return { cls: 'badge-info', key: 'vawe.flagCommitted', en: 'Committed' };
  return { cls: 'badge-gray', key: 'vawe.flagAwaiting', en: 'Awaiting date' };
}

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = reject;
  r.readAsDataURL(file);
});

export default function SoInstructionsTile({ stationId }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const isManager = user?.role === 'manager';
  const isOwner = user?.role === 'owner';
  // "Can act" needs an OPEN task AND the right role (manager always; owner only
  // once VAWE unlocked it via escalation). Completed tasks are read-only.
  const canActFor = (it) => it?.status === 'OPEN' && (isManager || (isOwner && !!it?.owner_can_act));
  const [items, setItems] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [tab, setTab] = useState('pending');

  const load = useCallback(async () => {
    if (!stationId) return;
    try {
      const res = await getVaweInteractions(stationId);
      setItems(res?.interactions || []);
    } catch { /* keep last */ }
  }, [stationId]);

  useEffect(() => { load(); }, [load]);

  if (!items.length) return null;
  const pending = items.filter((i) => i.status !== 'CLOSED');
  const completed = items.filter((i) => i.status === 'CLOSED');
  const shown = tab === 'completed' ? completed : pending;
  const active = items.find((i) => i.id === openId) || null;
  const anyActable = pending.some(canActFor);

  const tabBtn = (id, labelText, count, activeCls) => (
    <button
      onClick={() => setTab(id)}
      className={`badge ${tab === id ? activeCls : 'badge-gray'}`}
      style={{ cursor: 'pointer', border: 'none', font: 'inherit' }}
    >
      {labelText} ({count})
    </button>
  );

  return (
    <>
      <div style={{ background: 'var(--surface,#fff)', border: '0.5px solid var(--border,#e5e7eb)', borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, background: '#fff1e7', color: '#e8701e', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <ClipboardList size={17} />
          </span>
          <span style={{ fontSize: 14, fontWeight: 800 }}>{tc('vawe.title', 'SO Instructions')}</span>
        </div>

        {/* Pending / Completed tabs. */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {tabBtn('pending', tc('vawe.tabPending', 'Pending'), pending.length, 'badge-warning')}
          {tabBtn('completed', tc('vawe.tabCompleted', 'Completed'), completed.length, 'badge-success')}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.length === 0 && (
            <div style={{ fontSize: 12.5, color: 'var(--text-3,#7a7773)', padding: '4px 2px' }}>
              {tab === 'completed'
                ? tc('vawe.noneCompleted', 'No completed tasks yet.')
                : tc('vawe.nonePending', 'Nothing pending — all done!')}
            </div>
          )}
          {shown.map((it) => {
            const f = flagOf(it);
            const actable = canActFor(it);
            return (
              <div
                key={it.id}
                onClick={() => setOpenId(it.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--surface-2,#f8fafc)', borderRadius: 10, cursor: 'pointer' }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.instruction || it.task_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3,#7a7773)', marginTop: 2 }}>
                    {it.status === 'CLOSED'
                      ? (it.has_artifact
                          ? `${tc('vawe.completedOn', 'Completed')} ${fmt(it.updated_at)}`
                          : `${tc('vawe.withdrawnOn', 'Withdrawn by the sales officer')} · ${fmt(it.updated_at)}`)
                      : `${tc('vawe.deadline', 'Deadline')}: ${it.committed_date ? fmtDT(it.committed_date) : (it.desired_by ? `${fmtDT(it.desired_by)} (${tc('vawe.target', 'target')})` : tc('vawe.notSet', 'not set'))}`}
                    {it.has_artifact && <> · <Paperclip size={11} style={{ verticalAlign: -1 }} /> {tc('vawe.proof', 'proof')}</>}
                  </div>
                </div>
                <span className={`badge ${f.cls}`}>{tc(f.key, f.en)}</span>
                {actable ? (
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ flexShrink: 0 }}
                    onClick={(e) => { e.stopPropagation(); setOpenId(it.id); }}
                  >
                    {tc('vawe.open', 'Open')} ›
                  </button>
                ) : (
                  <ChevronRight size={18} style={{ color: 'var(--text-3,#7a7773)', flexShrink: 0 }} />
                )}
              </div>
            );
          })}
        </div>

        {tab === 'pending' && pending.length > 0 && !anyActable && (
          <div style={{ fontSize: 11.5, color: 'var(--text-3,#7a7773)', marginTop: 10 }}>
            {tc('vawe.readonlyList', 'Read-only — the outlet manager acts on these.')}
          </div>
        )}
      </div>

      {active && (
        <InteractionDrawer
          key={active.id}
          it={active}
          canAct={canActFor(active)}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}
    </>
  );
}

function InteractionDrawer({ it, canAct, onClose, onChanged }) {
  const { t } = useTranslation();
  const tc = (k, d) => { const v = t(k); return v === k ? d : v; };
  const [committed, setCommitted] = useState(toLocalInput(it.committed_date));
  // The last SAVED commit-by value, so the Save button knows when there are
  // unsaved edits (dirty) and can confirm "Saved ✓" once persisted.
  const [savedCommitted, setSavedCommitted] = useState(toLocalInput(it.committed_date));
  const [busy, setBusy] = useState('');            // '', 'commit', 'upload', 'complete'
  const [error, setError] = useState('');
  const [proof, setProof] = useState(null);         // fetched proof URL
  const hasArtifact = !!it.has_artifact;
  const commitDirty = committed !== savedCommitted;
  const isClosed = it.status === 'CLOSED';
  const fileRef = useRef(null);
  const f = flagOf({ ...it, committed_date: committed || null });

  const saveCommit = async () => {
    setBusy('commit'); setError('');
    try {
      await commitVaweInteraction(it.id, committed ? new Date(committed).toISOString() : null);
      setSavedCommitted(committed);
      onChanged();
    } catch (e) { setError(e?.error || tc('vawe.errSaveDate', 'Could not save the date.')); }
    finally { setBusy(''); }
  };

  // Proof IS completion: the server settles the task on upload (stamps the
  // commit date, closes it, tells VAWE to stop calling). So a successful upload
  // refreshes the list and closes the drawer — the task moves to Completed.
  const onFile = async (file) => {
    if (!file) return;
    setBusy('upload'); setError('');
    try {
      const base64 = await fileToBase64(file);
      await uploadVaweArtifact(it.id, { base64, media_type: file.type, filename: file.name });
      if (fileRef.current) fileRef.current.value = '';
      onChanged();
      onClose();
    } catch (e) {
      setError(e?.error || tc('vawe.errUpload', 'Upload failed.'));
      if (fileRef.current) fileRef.current.value = '';
      setBusy('');
    }
  };

  const viewProof = async () => {
    try { const r = await getVaweArtifact(it.id); setProof(r?.data_url || null); }
    catch (e) { setError(e?.error || tc('vawe.errLoadProof', 'Could not load the proof.')); }
  };

  const markComplete = async () => {
    setBusy('complete'); setError('');
    try { await completeVaweInteraction(it.id); onChanged(); onClose(); }
    catch (e) { setError(e?.error || tc('vawe.errComplete', 'Could not mark complete.')); setBusy(''); }
  };

  const label = { fontSize: 12, fontWeight: 600, color: 'var(--text-2,#475569)', marginBottom: 4, display: 'block' };
  const meta  = { fontSize: 13, color: 'var(--text-1,#1a1916)' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(420px, 92vw)', height: '100%', background: 'var(--surface,#fff)', boxShadow: '-8px 0 24px rgba(0,0,0,0.12)', padding: '18px 20px', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 15, fontWeight: 800, flex: 1 }}>{tc('vawe.soInstruction', 'SO Instruction')}</span>
          <span className={`badge ${f.cls}`}>{tc(f.key, f.en)}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-3,#7a7773)' }}><X size={18} /></button>
        </div>

        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{it.task_name}</div>
        <div style={{ ...meta, whiteSpace: 'pre-wrap', marginBottom: 16 }}>{it.instruction}</div>

        <div style={{ display: 'flex', gap: 20, marginBottom: 18 }}>
          <div>
            <span style={label}>{tc('vawe.soTarget', "SO's target")}</span>
            <span style={meta}>{it.desired_by ? fmtDT(it.desired_by) : tc('vawe.none', 'none')}</span>
          </div>
          <div>
            <span style={label}>{tc('vawe.sentOn', 'Sent on')}</span>
            <span style={meta}>{fmt(it.so_executed_at)}</span>
          </div>
        </div>

        {/* Commit-by date — the operative deadline. */}
        <div style={{ marginBottom: 18 }}>
          <span style={label}><CalendarClock size={13} style={{ verticalAlign: -2 }} /> {tc('vawe.commitBy', 'Commit-by date')}</span>
          {canAct ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="datetime-local"
                value={committed}
                min={toLocalInput(new Date())}
                disabled={busy === 'commit'}
                onChange={(e) => setCommitted(e.target.value)}
                style={{ padding: '7px 10px', border: '1px solid var(--border,#e5e7eb)', borderRadius: 8, fontSize: 13.5 }}
              />
              <button
                className="btn btn-primary btn-sm"
                disabled={busy === 'commit' || !committed || !commitDirty}
                onClick={saveCommit}
              >
                {busy === 'commit' ? tc('vawe.saving', 'Saving…') : (commitDirty ? tc('vawe.saveDate', 'Save date') : tc('vawe.saved', 'Saved ✓'))}
              </button>
            </div>
          ) : (
            <span style={meta}>{committed ? fmtDT(committed) : tc('vawe.notSetByManager', 'not set by manager yet')}</span>
          )}
        </div>

        {/* Proof of completion. */}
        <div style={{ marginBottom: 18 }}>
          <span style={label}><Paperclip size={13} style={{ verticalAlign: -2 }} /> {tc('vawe.proofLabel', 'Proof')}</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {canAct && (
              <>
                <input ref={fileRef} type="file" accept="image/*,video/*,application/pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
                <button className="btn btn-secondary btn-sm" disabled={busy === 'upload'} onClick={() => fileRef.current?.click()}>
                  <Upload size={14} /> {busy === 'upload' ? tc('vawe.uploading', 'Uploading…') : (hasArtifact ? tc('vawe.replace', 'Replace') : tc('vawe.upload', 'Upload'))}
                </button>
              </>
            )}
            {hasArtifact
              ? <button className="btn btn-secondary btn-sm" onClick={viewProof}>{tc('vawe.viewProof', 'View proof')}</button>
              : !canAct && <span style={{ ...meta, color: 'var(--text-3,#7a7773)' }}>{tc('vawe.noneUploaded', 'none uploaded')}</span>}
          </div>
          {proof && (
            <div style={{ marginTop: 10 }}>
              {proof.startsWith('data:image')
                ? <img src={proof} alt="proof" style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--border,#e5e7eb)' }} />
                : <a href={proof} download="so-proof.pdf" className="btn btn-secondary btn-sm">{tc('vawe.downloadPdf', 'Download PDF')}</a>}
            </div>
          )}
        </div>

        {error && (
          <div className="alert-banner danger" style={{ marginBottom: 14 }}>
            <AlertTriangle size={16} style={{ flexShrink: 0 }} /> {error}
          </div>
        )}

        {canAct ? (
          <>
            <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy === 'complete' || !hasArtifact} onClick={markComplete}>
              <CheckCircle2 size={16} /> {busy === 'complete' ? tc('vawe.completing', 'Completing…') : tc('vawe.markComplete', 'Mark complete')}
            </button>
            {!hasArtifact && (
              <div style={{ fontSize: 11.5, color: 'var(--text-3,#7a7773)', textAlign: 'center', marginTop: 8 }}>
                {tc('vawe.uploadToEnable', 'Upload proof to enable “Mark complete”.')}
              </div>
            )}
          </>
        ) : isClosed ? (
          hasArtifact ? (
            <div style={{ fontSize: 13, color: '#16a34a', textAlign: 'center', fontWeight: 600 }}>
              <CheckCircle2 size={15} style={{ verticalAlign: -3 }} /> {tc('vawe.completed', 'Completed')} — {tc('vawe.proofOnFile', 'proof on file')}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-3,#7a7773)', textAlign: 'center', fontWeight: 600 }}>
              {tc('vawe.withdrawn', 'Withdrawn by the sales officer — no action needed.')}
            </div>
          )
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-3,#7a7773)', textAlign: 'center' }}>
            {tc('vawe.readonlyComplete', 'Read-only — the outlet manager completes this task.')}
          </div>
        )}
      </div>
    </div>
  );
}
