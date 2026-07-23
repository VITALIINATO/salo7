import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';

const LOCAL_STORAGE_KEY = 'schedule_data';
const NAMES = ['БЕЛИК', 'МО', 'НАТО'];

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

  // Fetch function with direct fallback to npoint if server unreachable
  const fetchSchedule = useCallback(async (isManual = false) => {
    if (isManual) setIsLoading(true);
    try {
      // Primary local server endpoint
      const res = await fetch('/api/schedule');
      if (res.ok) {
        const data = await res.json();
        if (data.schedule) {
          setSchedule(data.schedule);
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data.schedule));
        }
        if (data.lastUpdated) {
          setLastUpdated(data.lastUpdated);
        }
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn('Server fetch error, trying direct npoint fallback:', err);
      try {
        const res = await fetch('https://api.npoint.io/a2c459559145e6cd5082');
        if (res.ok) {
          const data = await res.json();
          setSchedule(data || {});
          setLastUpdated(new Date().toISOString());
        }
      } catch (fallbackErr) {
        const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (cached) {
          try {
            setSchedule(JSON.parse(cached));
          } catch (e) {
            console.error('Failed to parse cached schedule:', e);
          }
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Set up SSE for real-time synchronization + polling fallback
  useEffect(() => {
    fetchSchedule();

    // 1. SSE for immediate real-time sync
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
      console.warn('SSE not supported or connection failed:', e);
      setIsLiveConnected(false);
    }

    // 2. Interval polling every 3 seconds as robust cross-device fallback
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
    // Optimistic state update
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
      // Save through backend API
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateKey, person }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn('Backend save failed, using direct npoint fallback:', err);
      try {
        await fetch('https://api.npoint.io/a2c459559145e6cd5082', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newSchedule),
        });
      } catch (fallbackErr) {
        console.error('Direct npoint save error:', fallbackErr);
      }
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
        <div className="mt-4 text-lg font-semibold text-indigo-600">Загрузка...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-2 sm:p-4">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-xl p-4 sm:p-6 relative">
        {/* Top middle banner: "Обновлено: <время>" as requested */}
        <div className="flex items-center justify-center gap-2 mb-4 bg-indigo-50/70 border border-indigo-100 rounded-xl py-2 px-4 text-xs sm:text-sm text-indigo-900 font-medium w-fit mx-auto">
          <span className="flex items-center gap-1.5">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isLiveConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
              }`}
              title={isLiveConnected ? 'Синхронизация в реальном времени' : 'Периодическое обновление'}
            />
            <span>Обновлено:</span>
            <strong className="font-semibold text-indigo-950">{formattedLastUpdated}</strong>
          </span>

          <button
            type="button"
            onClick={() => fetchSchedule(true)}
            className="ml-1.5 p-1 text-indigo-600 hover:text-indigo-900 hover:bg-indigo-100/60 rounded-full transition-colors"
            title="Обновить вручную"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <header className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={() => changeMonth(-1)}
            className="p-2 rounded-full hover:bg-indigo-50 text-indigo-800 font-bold transition-colors"
          >
            ←
          </button>
          <h2 className="text-lg sm:text-xl font-bold text-indigo-800 capitalize">
            {currentDate.toLocaleString('ru-RU', { month: 'long' })} {currentDate.getFullYear()}
          </h2>
          <button
            type="button"
            onClick={() => changeMonth(1)}
            className="p-2 rounded-full hover:bg-indigo-50 text-indigo-800 font-bold transition-colors"
          >
            →
          </button>
        </header>

        <div className="calendar-grid text-xs sm:text-sm text-center font-bold text-indigo-900 mb-2">
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
                className={`aspect-square flex flex-col justify-start items-center p-1 sm:p-2 border rounded-lg transition-all ${
                  current
                    ? person
                      ? 'bg-gradient-to-br from-violet-50 to-purple-50 border-violet-200'
                      : 'bg-white border-slate-200 hover:bg-indigo-50'
                    : 'bg-slate-100/70 text-slate-400 border-transparent'
                }`}
              >
                <time
                  className={`w-7 h-7 flex items-center justify-center rounded-full text-sm sm:text-base ${
                    current ? 'text-indigo-800' : 'text-slate-400'
                  } ${
                    isToday
                      ? ' bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-bold shadow-md'
                      : ''
                  }`}
                >
                  {date.getDate()}
                </time>

                {current && person && (
                  <>
                    {(isPast || isToday) && (
                      <div className="my-0.5 w-2 h-2 bg-emerald-500 rounded-full" title="Прошедшая/текущая дата" />
                    )}
                    {!isPast && !isToday && (
                      <div className="my-0.5 w-2 h-2 bg-amber-500 rounded-full" title="Будущая дата" />
                    )}
                  </>
                )}

                {current && (
                  <div className="w-full mt-auto">
                    <select
                      value={person || ''}
                      onChange={(e) => handleSelect(date, e.target.value)}
                      className={`w-full mt-0.5 text-xs sm:text-sm bg-transparent focus:outline-none text-center cursor-pointer overflow-hidden whitespace-nowrap py-1 ${
                        person ? 'text-purple-700 font-semibold' : 'text-slate-600'
                      }`}
                    >
                      <option value="" />
                      {NAMES.map((name) => (
                        <option key={name} value={name}>
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
          <div className="absolute bottom-4 right-4 text-xs text-violet-600 font-medium animate-pulse bg-white px-3 py-1 rounded-full shadow-md border border-violet-100 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-violet-600 rounded-full animate-ping" />
            Сохранение...
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
