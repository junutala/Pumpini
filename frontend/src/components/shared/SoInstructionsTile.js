'use client';

// SO Instructions — the VAWE → Pumpini operational-task tile.
//
// A Sales Officer pushes tasks from VAWE; each outlet gets one OPEN interaction.
// This tile surfaces them on the manager's operations dashboard (and, because
// the owner's group dashboard embeds the same DashboardPage per outlet, on the
// owner's view too — read-only). The manager sets a commit-by date, uploads
// proof, and marks the task complete; completing it flips status→CLOSED, which
// removes the tile. It renders nothing when there are no open instructions.

import { useState, useEffect, useCallback, useRef } from 'react';
import { ClipboardList, CalendarClock, Upload, CheckCircle2, X, Paperclip, AlertTriangle } from 'lucide-react';
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

// Deadline + flag: the manager's committed date+time is the operative deadline;
// fall back to the SO's soft target. Overdue → red, revised-past-target →
// yellow (Mgmt by Exception), committed → blue, otherwise awaiting a date.
function flagOf(it) {
  const now = Date.now();
  const committed = ms(it.committed_date);
  const deadline = committed ?? ms(it.desired_by);
  if (deadline && deadline < now) return { cls: 'badge-danger', label: 'Overdue' };
  const soft = ms(it.desired_by);
  if (committed && soft && committed > soft) return { cls: 'badge-warning', label: 'Revised' };
  if (committed) return { cls: 'badge-info', label: 'Committed' };
  return { cls: 'badge-gray', label: 'Awaiting date' };
}

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = reject;
  r.readAsDataURL(file);
});

export default function SoInstructionsTile({ stationId }) {
  const { user } = useAuth();
  // The manager can always act. The owner acts only on interactions VAWE has
  // unlocked (owner_can_act) — i.e. escalation reached the owner cycle. Everyone
  // else (CCO) stays read-only. So "can act" is per-interaction, not per-user.
  const isManager = user?.role === 'manager';
  const isOwner = user?.role === 'owner';
  const canActFor = (it) => isManager || (isOwner && !!it?.owner_can_act);
  const [items, setItems] = useState([]);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    if (!stationId) return;
    try {
      const res = await getVaweInteractions(stationId);
      setItems(res?.interactions || []);
    } catch { /* keep last */ }
  }, [stationId]);

  useEffect(() => { load(); }, [load]);

  if (!items.length) return null;
  const active = items.find((i) => i.id === openId) || null;
  const anyActable = items.some(canActFor);

  return (
    <>
      <div style={{ background: 'var(--surface,#fff)', border: '0.5px solid var(--border,#e5e7eb)', borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, background: '#fff1e7', color: '#e8701e', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <ClipboardList size={17} />
          </span>
          <span style={{ fontSize: 14, fontWeight: 800 }}>SO Instructions</span>
          <span className="badge badge-warning" style={{ marginLeft: 'auto' }}>{items.length} open</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((it) => {
            const f = flagOf(it);
            return (
              <div
                key={it.id}
                onClick={() => setOpenId(it.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--surface-2,#f8fafc)', borderRadius: 10, cursor: 'pointer' }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.instruction || it.task_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3,#7a7773)', marginTop: 2 }}>
                    Deadline: {it.committed_date ? fmtDT(it.committed_date) : (it.desired_by ? `${fmtDT(it.desired_by)} (target)` : 'not set')}
                    {it.has_artifact && <> · <Paperclip size={11} style={{ verticalAlign: -1 }} /> proof</>}
                  </div>
                </div>
                <span className={`badge ${f.cls}`}>{f.label}</span>
              </div>
            );
          })}
        </div>
        {!anyActable && (
          <div style={{ fontSize: 11.5, color: 'var(--text-3,#7a7773)', marginTop: 10 }}>
            Read-only — the outlet manager acts on these.
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
  const [committed, setCommitted] = useState(toLocalInput(it.committed_date));
  // The last SAVED commit-by value, so the Save button knows when there are
  // unsaved edits (dirty) and can confirm "Saved ✓" once persisted.
  const [savedCommitted, setSavedCommitted] = useState(toLocalInput(it.committed_date));
  const [busy, setBusy] = useState('');            // '', 'commit', 'upload', 'complete'
  const [error, setError] = useState('');
  const [proof, setProof] = useState(null);         // fetched proof URL
  // Proof present if the server already has one, or we just uploaded — so the
  // "Mark complete" gate opens immediately, without waiting for a refetch.
  const [justUploaded, setJustUploaded] = useState(false);
  const hasArtifact = !!it.has_artifact || justUploaded;
  const commitDirty = committed !== savedCommitted;
  const fileRef = useRef(null);
  const f = flagOf({ ...it, committed_date: committed || null });

  // Manager edits the date locally, then presses Save — an explicit
  // confirmation (auto-save gave no feedback). Sends a full ISO timestamp.
  const saveCommit = async () => {
    setBusy('commit'); setError('');
    try {
      await commitVaweInteraction(it.id, committed ? new Date(committed).toISOString() : null);
      setSavedCommitted(committed);
      onChanged();
    } catch (e) { setError(e?.error || 'Could not save the date.'); }
    finally { setBusy(''); }
  };

  // Uploading proof ENABLES "Mark complete" (the explicit settle). It no longer
  // auto-closes the drawer, so the manager sees the proof land and the button
  // turn on, then completes deliberately.
  const onFile = async (file) => {
    if (!file) return;
    setBusy('upload'); setError('');
    try {
      const base64 = await fileToBase64(file);
      await uploadVaweArtifact(it.id, { base64, media_type: file.type, filename: file.name });
      if (fileRef.current) fileRef.current.value = '';
      setJustUploaded(true);
      onChanged();
    } catch (e) {
      setError(e?.error || 'Upload failed.');
      if (fileRef.current) fileRef.current.value = '';
    } finally { setBusy(''); }
  };

  const viewProof = async () => {
    try { const r = await getVaweArtifact(it.id); setProof(r?.data_url || null); }
    catch (e) { setError(e?.error || 'Could not load the proof.'); }
  };

  const markComplete = async () => {
    setBusy('complete'); setError('');
    try { await completeVaweInteraction(it.id); onChanged(); onClose(); }
    catch (e) { setError(e?.error || 'Could not mark complete.'); setBusy(''); }
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
          <span style={{ fontSize: 15, fontWeight: 800, flex: 1 }}>SO Instruction</span>
          <span className={`badge ${f.cls}`}>{f.label}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-3,#7a7773)' }}><X size={18} /></button>
        </div>

        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{it.task_name}</div>
        <div style={{ ...meta, whiteSpace: 'pre-wrap', marginBottom: 16 }}>{it.instruction}</div>

        <div style={{ display: 'flex', gap: 20, marginBottom: 18 }}>
          <div>
            <span style={label}>SO's target</span>
            <span style={meta}>{it.desired_by ? fmtDT(it.desired_by) : 'none'}</span>
          </div>
          <div>
            <span style={label}>Sent on</span>
            <span style={meta}>{fmt(it.so_executed_at)}</span>
          </div>
        </div>

        {/* Commit-by date — the operative deadline. */}
        <div style={{ marginBottom: 18 }}>
          <span style={label}><CalendarClock size={13} style={{ verticalAlign: -2 }} /> Commit-by date</span>
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
                {busy === 'commit' ? 'Saving…' : (commitDirty ? 'Save date' : 'Saved ✓')}
              </button>
            </div>
          ) : (
            <span style={meta}>{committed ? fmtDT(committed) : 'not set by manager yet'}</span>
          )}
        </div>

        {/* Proof of completion. */}
        <div style={{ marginBottom: 18 }}>
          <span style={label}><Paperclip size={13} style={{ verticalAlign: -2 }} /> Proof</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {canAct && (
              <>
                <input ref={fileRef} type="file" accept="image/*,video/*,application/pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
                <button className="btn btn-secondary btn-sm" disabled={busy === 'upload'} onClick={() => fileRef.current?.click()}>
                  <Upload size={14} /> {busy === 'upload' ? 'Uploading…' : (hasArtifact ? 'Replace' : 'Upload')}
                </button>
              </>
            )}
            {hasArtifact
              ? <button className="btn btn-secondary btn-sm" onClick={viewProof}>View proof</button>
              : !canAct && <span style={{ ...meta, color: 'var(--text-3,#7a7773)' }}>none uploaded</span>}
          </div>
          {proof && (
            <div style={{ marginTop: 10 }}>
              {proof.startsWith('data:image')
                ? <img src={proof} alt="proof" style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--border,#e5e7eb)' }} />
                : <a href={proof} download="so-proof.pdf" className="btn btn-secondary btn-sm">Download PDF</a>}
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
              <CheckCircle2 size={16} /> {busy === 'complete' ? 'Completing…' : 'Mark complete'}
            </button>
            {!hasArtifact && (
              <div style={{ fontSize: 11.5, color: 'var(--text-3,#7a7773)', textAlign: 'center', marginTop: 8 }}>
                Upload proof to enable “Mark complete”.
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-3,#7a7773)', textAlign: 'center' }}>
            Read-only — the outlet manager completes this task.
          </div>
        )}
      </div>
    </div>
  );
}
