'use client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, CheckCheck, Filter } from 'lucide-react';
import AppShell from '../../components/shared/AppShell';
import { getAlerts, acknowledgeAlert } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSocket } from '../../hooks/useSocket';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';

const SEVERITY_STYLE = {
  info:     { cls: 'badge-info',    banner: 'info'    },
  warning:  { cls: 'badge-warning', banner: 'warning' },
  critical: { cls: 'badge-danger',  banner: 'danger'  },
};

const TYPE_LABELS = {
  cash_variance:  '💰 Cash Variance',
  low_stock:      '⛽ Low Stock',
  credit_limit:   '🏢 Credit Limit',
  shift_variance: '📊 Shift Variance',
};

export default function AlertsPage() {
  const { t } = useTranslation();
  const tc = (k,d) => { const v=t(k); return v===k?d:v; };
  const { station } = useAuth();
  const stationId = typeof station === 'object' ? station?.id : station;

  const [alerts, setAlerts]   = useState([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  const { on } = useSocket(stationId, null);

  const load = async () => {
    if (!stationId) return;
    const rows = await getAlerts({ station_id: stationId, ...(unreadOnly ? { unread: true } : {}) });
    setAlerts(rows);
    setLoading(false);
  };

  useEffect(() => { load(); }, [stationId, unreadOnly]);

  // Real-time new alerts
  useEffect(() => on('alert:new', () => load()), [on]);
  useRefreshOnFocus(load);

  const ack = async (id) => {
    await acknowledgeAlert(id);
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged_at: new Date().toISOString() } : a));
  };

  const ackAll = async () => {
    const unread = alerts.filter(a => !a.acknowledged_at);
    await Promise.all(unread.map(a => acknowledgeAlert(a.id)));
    load();
  };

  const unreadCount = alerts.filter(a => !a.acknowledged_at).length;

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('alert.title')}</h1>
          {unreadCount > 0 && <div style={{ fontSize: 13, color: 'var(--danger)', marginTop: 2 }}>{unreadCount} {tc('alert.unacknowledged','unacknowledged')}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`btn ${unreadOnly ? 'btn-primary' : 'btn-secondary'} btn-sm`}
            onClick={() => setUnreadOnly(p => !p)}>
            <Filter size={13} /> {unreadOnly ? tc('alert.showing_unread','Showing Unread') : tc('common.all','All')}
          </button>
          {unreadCount > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={ackAll}>
              <CheckCheck size={14} /> {tc('alert.ack_all','Acknowledge All')}
            </button>
          )}
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '3rem' }}>{tc('common.loading','Loading...')}</div>}

      {!loading && alerts.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <Bell size={32} color="var(--text-3)" style={{ margin: '0 auto 12px' }} />
          <div style={{ color: 'var(--text-3)' }}>{tc('alert.no_alerts','No alerts')} {unreadOnly ? tc('alert.unread','unread') : tc('alert.recorded','recorded')}</div>
        </div>
      )}

      <div>
        {alerts.map(alert => {
          const s = SEVERITY_STYLE[alert.severity] || SEVERITY_STYLE.info;
          const isRead = !!alert.acknowledged_at;
          return (
            <div key={alert.id} className={`alert-banner ${s.banner}`}
              style={{ marginBottom: 10, opacity: isRead ? 0.65 : 1, transition: 'opacity 0.3s' }}>
              <Bell size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{TYPE_LABELS[alert.alert_type] || alert.alert_type}</span>
                  <span className={`badge ${s.cls}`} style={{ fontSize: 11 }}>{alert.severity}</span>
                  {isRead && <span className="badge badge-gray" style={{ fontSize: 11 }}>{tc('alert.acknowledged','acknowledged')}</span>}
                </div>
                <div style={{ fontSize: 13 }}>{alert.message}</div>
                <div style={{ fontSize: 11, color: 'inherit', opacity: 0.7, marginTop: 4 }}>
                  {new Date(alert.sent_at).toLocaleString('en-IN')}
                  {alert.channels && ` · via ${alert.channels.join(', ')}`}
                </div>
              </div>
              {!isRead && (
                <button className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }} onClick={() => ack(alert.id)}>
                  <CheckCheck size={13} /> {tc('alert.acknowledge','Ack')}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
