import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';

const LOCAL_STORAGE_KEY = 'schedule_data';
const NAMES = ['БЕЛИК', 'МО', 'НАТО'];
const NPOINT_URL = 'https://api.npoint.io/a2c459559145e6cd5082';

export function App() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [schedule, setSchedule] = useState<Record<string, string>>({});
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [error] = useState<string | null>(null);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Fetch function with direct cache-busting to ensure cross-device synchronization
  const fetchSchedule = useCallback(async (isManual = false) => {
    if (isManual) setIsLoading(true);
    let success = false;

    // 1. Try local Express API if available (e.g. running fullstack container)
    try {
      const res = await fetch('/api/schedule', { cache: 'no-store' });
      if (res.ok) {
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const data = await res.json();
          if (data && data.schedule) {
            setSchedule(data.schedule);
            setLastUpdated(data.lastUpdated || new Date().toISOString());
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data.schedule));
            success = true;
          }
        }
      }
    } catch {
      // Ignore static host 404
    }

    // 2. Direct cloud fetch with timestamp parameter to bypass Cloudflare CDN cache
    if (!success) {
      try {
        const cacheBusterUrl = `${NPOINT_URL}?_t=${Date.now()}`;
        const res = await fetch(cacheBusterUrl, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data && typeof data === 'object') {
            setSchedule(data);
            setLastUpdated(new Date().toISOString());
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
            success = true;
          }
        }
      } catch (err) {
        console.warn('Cloud sync error:', err);
      }
    }

    // 3. LocalStorage fallback if offline
    if (!success) {
      const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (cached) {
        try {
          setSchedule(JSON.parse(cached));
        } catch (e) {
          console.error('Failed to parse cached schedule:', e);
        }
      }
    }

    setIsLoading(false);
  }, []);

  // Set up SSE for real-time synchronization + polling fallback
  useEffect(() => {
    fetchSchedule();

    // 1. SSE for immediate real-time sync when on fullstack server
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource('/api/schedule/stream');

      eventSource.onopen = () => {
        setIsLiveConnected(true);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.schedule) {
            setSchedule(data.schedule);
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data.schedule));
          }
          if (data.lastUpdated) {
            setLastUpdated(data.lastUpdated);
          }
        } catch (e) {
          console.error('SSE parse error:', e);
        }
      };

      eventSource.onerror = () => {
        setIsLiveConnected(false);
      };
    } catch (e) {
      setIsLiveConnected(false);
    }

    // 2. Interval polling every 3 seconds for instant cross-device updates
    const intervalId = setInterval(() => {
      fetchSchedule();
    }, 3000);

    // 3. Fetch when returning to the tab / window focus
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchSchedule();
      }
    };
    const handleFocus = () => {
      fetchSchedule();
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      if (eventSource) eventSource.close();
      clearInterval(intervalId);
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchSchedule]);

  const saveData = async (dateKey: string, person: string) => {
    setIsSaving(true);
    // Optimistic local state update
    const newSchedule = { ...schedule };
    if (person) {
      newSchedule[dateKey] = person;
    } else {
      delete newSchedule[dateKey];
    }
    setSchedule(newSchedule);
    const nowIso = new Date().toISOString();
    setLastUpdated(nowIso);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newSchedule));

    try {
      // Try local Express server API if running on fullstack host
      try {
        await fetch('/api/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dateKey, person }),
        });
      } catch {
        // Ignore static host
      }

      // Always update global npoint store so all devices (phones, computers) sync instantly
      await fetch(NPOINT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSchedule),
      });
    } catch (err) {
      console.error('Save error:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelect = useCallback(
    (date: Date, person: string) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const key = `${year}-${month}-${day}`;
      saveData(key, person);
    },
    [schedule]
  );

  const changeMonth = (offset: number) => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
  };

  const days = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDay = (firstDay.getDay() + 6) % 7;
    const result: Array<{ date: Date; current: boolean; today?: boolean }> = [];

    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDay; i > 0; i--) {
      result.push({
        date: new Date(year, month - 1, prevMonthLastDay - i + 1),
        current: false,
      });
    }
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const d = new Date(year, month, i);
      result.push({
        date: d,
        current: true,
        today: d.getTime() === today.getTime(),
      });
    }
    let nextMonthDay = 1;
    while (result.length < 42) {
      result.push({
        date: new Date(year, month + 1, nextMonthDay++),
        current: false,
      });
    }
    return result;
  }, [currentDate, today]);

  // Format last update time neatly
  const formattedLastUpdated = useMemo(() => {
    if (!lastUpdated) return 'Загрузка...';
    try {
      const date = new Date(lastUpdated);
      if (isNaN(date.getTime())) return 'Неизвестно';

      // Time string like 14:25:30
      const timeStr = date.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      // If update was not today, add day/month
      const now = new Date();
      if (
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate()
      ) {
        return timeStr;
      } else {
        const dateStr = date.toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'short',
        });
        return `${dateStr}, ${timeStr}`;
      }
    } catch (e) {
      return 'Неизвестно';
    }
  }, [lastUpdated]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="loader" />
        <div className="mt-4 text-lg font-bold text-amber-400 drop-shadow">Загрузка...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-1.5 sm:p-4">
      <div className="w-full max-w-4xl bg-[#20291d]/95 backdrop-blur-md rounded-2xl shadow-2xl border border-[#3b4934] p-2.5 sm:p-6 relative text-stone-100">
        {/* Top middle banner: "Обновлено: <время>" */}
        <div className="flex items-center justify-center gap-2 mb-3 sm:mb-4 bg-[#141b12]/90 border border-[#36452f] rounded-xl py-1.5 px-3 sm:py-2 sm:px-4 text-xs sm:text-sm text-amber-300/90 font-medium w-fit mx-auto shadow-inner">
          <span className="flex items-center gap-1.5">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isLiveConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
              }`}
              title={isLiveConnected ? 'Синхронизация в реальном времени' : 'Авто-обновление подключено'}
            />
            <span>Обновлено:</span>
            <strong className="font-semibold text-amber-300">{formattedLastUpdated}</strong>
          </span>

          <button
            type="button"
            onClick={() => fetchSchedule(true)}
            className="ml-1 p-1 text-amber-400 hover:text-amber-200 hover:bg-[#2e3b28] rounded-full transition-colors"
            title="Обновить вручную"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-950/80 border border-red-800 rounded-lg text-red-200 text-sm">
            {error}
          </div>
        )}

        <header className="flex items-center justify-between mb-3 sm:mb-4 px-1">
          <button
            type="button"
            onClick={() => changeMonth(-1)}
            className="p-1.5 sm:p-2 rounded-xl bg-[#2e3b28] hover:bg-[#3d4e35] text-amber-300 font-bold border border-[#44553b] transition-all"
          >
            ←
          </button>
          <h2 className="text-base sm:text-xl font-extrabold text-amber-300 uppercase tracking-wider">
            {currentDate.toLocaleString('ru-RU', { month: 'long' })} {currentDate.getFullYear()}
          </h2>
          <button
            type="button"
            onClick={() => changeMonth(1)}
            className="p-1.5 sm:p-2 rounded-xl bg-[#2e3b28] hover:bg-[#3d4e35] text-amber-300 font-bold border border-[#44553b] transition-all"
          >
            →
          </button>
        </header>

        <div className="calendar-grid text-[11px] sm:text-sm text-center font-bold text-amber-400/90 tracking-wide uppercase mb-1.5">
          {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>

        <div className="calendar-grid gap-1">
          {days.map(({ date, current, today: isToday }) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const key = `${year}-${month}-${day}`;
            const person = schedule[key];
            const isPast = date < today;

            return (
              <div
                key={key}
                className={`min-h-[60px] sm:min-h-[76px] sm:aspect-square flex flex-col justify-between items-center p-0.5 sm:p-1.5 border rounded-lg transition-all ${
                  current
                    ? person
                      ? 'bg-gradient-to-b from-[#3a4732] to-[#2b3525] border-[#55674a] shadow-xs text-amber-200'
                      : 'bg-[#1b2218]/90 border-[#2f3c29] hover:bg-[#253120]'
                    : 'bg-[#121810]/40 text-stone-600 border-transparent'
                }`}
              >
                <div className="flex flex-col items-center">
                  <time
                    className={`w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-full text-xs sm:text-base font-medium ${
                      current ? 'text-stone-200' : 'text-stone-600'
                    } ${
                      isToday
                        ? ' bg-amber-500 text-stone-950 font-black border border-amber-300 shadow-md'
                        : ''
                    }`}
                  >
                    {date.getDate()}
                  </time>

                  {current && person && (
                    <div className="mt-0.5">
                      {(isPast || isToday) && (
                        <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-emerald-400 rounded-full" title="Прошедшая/текущая дата" />
                      )}
                      {!isPast && !isToday && (
                        <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-amber-400 rounded-full" title="Будущая дата" />
                      )}
                    </div>
                  )}
                </div>

                {current && (
                  <div className="w-full mt-auto text-center px-0 overflow-hidden">
                    <select
                      value={person || ''}
                      onChange={(e) => handleSelect(date, e.target.value)}
                      className={`w-full text-[10px] xs:text-[11px] sm:text-xs md:text-sm leading-tight bg-transparent focus:outline-none text-center cursor-pointer font-black tracking-tight py-0.5 px-0 ${
                        person ? 'text-amber-300' : 'text-stone-500 font-normal'
                      }`}
                    >
                      <option value="" className="bg-[#182015] text-stone-500 font-normal">
                        —
                      </option>
                      {NAMES.map((name) => (
                        <option key={name} value={name} className="bg-[#182015] text-amber-300 font-bold">
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {isSaving && (
          <div className="absolute bottom-4 right-4 text-xs text-amber-300 font-bold animate-pulse bg-[#161f14] px-3 py-1 rounded-full shadow-lg border border-[#3c4c35] flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-ping" />
            Сохранение...
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
