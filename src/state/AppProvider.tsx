import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from 'react';

import {
  currentVitals,
  initialScanSessions,
  initialSensors,
  personalBaseline,
} from '@/data/mockData';
import type { PersonalBaseline, SensorConnection, VitalSnapshot } from '@/domain/health';
import type { ScanSession } from '@/domain/scanning';
import { appStateRepository } from '@/services/storage/appStateRepository';
import type { StorageDescriptor } from '@/services/storage/types';

type PersistenceStatus = 'loading' | 'ready' | 'error';

type AppState = {
  latestVitals: VitalSnapshot;
  baseline: PersonalBaseline;
  sensors: SensorConnection[];
  sessions: ScanSession[];
  researchMode: boolean;
  isHydrated: boolean;
  persistenceStatus: PersistenceStatus;
  persistenceError?: string;
};

type AppAction =
  | { type: 'hydrate'; sessions: ScanSession[]; researchMode?: boolean }
  | { type: 'scan-completed'; session: ScanSession }
  | { type: 'toggle-research-mode'; enabled: boolean }
  | { type: 'persistence-error'; message: string }
  | { type: 'clear-local-data' };

type AppContextValue = AppState & {
  storage: StorageDescriptor;
  addScanSession: (session: ScanSession) => void;
  setResearchMode: (enabled: boolean) => void;
  clearLocalData: () => Promise<void>;
};

const initialState: AppState = {
  latestVitals: currentVitals,
  baseline: personalBaseline,
  sensors: initialSensors,
  sessions: initialScanSessions,
  researchMode: true,
  isHydrated: false,
  persistenceStatus: 'loading',
};

const reducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'hydrate': {
      const sessions = action.sessions.length > 0 ? action.sessions : state.sessions;
      return {
        ...state,
        latestVitals: sessions[0]?.wearableSnapshot ?? state.latestVitals,
        sessions,
        researchMode: action.researchMode ?? state.researchMode,
        isHydrated: true,
        persistenceStatus: 'ready',
        persistenceError: undefined,
      };
    }
    case 'scan-completed':
      return {
        ...state,
        latestVitals: action.session.wearableSnapshot,
        sessions: [action.session, ...state.sessions.filter(({ id }) => id !== action.session.id)],
      };
    case 'toggle-research-mode':
      return { ...state, researchMode: action.enabled };
    case 'persistence-error':
      return {
        ...state,
        isHydrated: true,
        persistenceStatus: 'error',
        persistenceError: action.message,
      };
    case 'clear-local-data':
      return {
        ...state,
        latestVitals: currentVitals,
        sessions: [],
        researchMode: true,
        persistenceStatus: 'ready',
        persistenceError: undefined,
      };
    default:
      return state;
  }
};

const AppContext = createContext<AppContextValue | null>(null);

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Okänt lagringsfel.';

export function AppProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    let isActive = true;

    void appStateRepository
      .load()
      .then((persistedState) => {
        if (isActive) {
          dispatch({
            type: 'hydrate',
            sessions: persistedState.sessions,
            researchMode: persistedState.researchMode,
          });
        }
      })
      .catch((error: unknown) => {
        if (isActive) {
          dispatch({ type: 'persistence-error', message: toErrorMessage(error) });
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  const reportPersistenceError = useCallback((error: unknown) => {
    dispatch({ type: 'persistence-error', message: toErrorMessage(error) });
  }, []);

  const addScanSession = useCallback(
    (session: ScanSession) => {
      dispatch({ type: 'scan-completed', session });
      void appStateRepository.saveSession(session).catch(reportPersistenceError);
    },
    [reportPersistenceError],
  );

  const setResearchMode = useCallback(
    (enabled: boolean) => {
      dispatch({ type: 'toggle-research-mode', enabled });
      void appStateRepository.saveResearchMode(enabled).catch(reportPersistenceError);
    },
    [reportPersistenceError],
  );

  const clearLocalData = useCallback(async () => {
    try {
      await appStateRepository.clear();
      dispatch({ type: 'clear-local-data' });
    } catch (error) {
      reportPersistenceError(error);
      throw error;
    }
  }, [reportPersistenceError]);

  const value = useMemo<AppContextValue>(
    () => ({
      ...state,
      storage: appStateRepository.descriptor,
      addScanSession,
      setResearchMode,
      clearLocalData,
    }),
    [addScanSession, clearLocalData, setResearchMode, state],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppState must be used within AppProvider');
  }
  return context;
}
