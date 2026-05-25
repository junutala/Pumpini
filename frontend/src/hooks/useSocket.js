'use client';
import { useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

let socket = null;

export function useSocket(stationId, shiftId) {
  const listenersRef = useRef({});

  useEffect(() => {
    if (!socket) {
      socket = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000', {
        auth: { token: localStorage.getItem('token') },
        reconnection: true,
      });
    }

    if (stationId) socket.emit('join_station', stationId);
    if (shiftId)   socket.emit('join_shift', shiftId);

    return () => {
      // Don't disconnect - socket is shared
    };
  }, [stationId, shiftId]);

  const on = useCallback((event, handler) => {
    if (!socket) return;
    socket.on(event, handler);
    listenersRef.current[event] = handler;
    return () => socket.off(event, handler);
  }, []);

  const emit = useCallback((event, data) => {
    if (socket) socket.emit(event, data);
  }, []);

  return { on, emit, socket };
}
