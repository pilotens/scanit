import {
  createContext,
  type PropsWithChildren,
  useContext,
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

type AppState = {
  latestVitals: VitalSnapshot;
  baseline: PersonalBaseline;
  sensors: SensorConnection[];
  sessions: ScanSession[];
  researchMode: boolean;
};

type AppAction =
  | { type: 'scan-completed'; session: ScanSession }
  | { type: 'toggle-research-mode'; enabled: boolean };

type AppContextValue = AppState & {
  addScanSession: (session: ScanSession) => void;
  setResearchMode: (enabled: boolean) => void;
};

const initialState: AppState = {
  latestVitals: currentVitals,
  baseline: personalBaseline,
  sensors: initialSensors,
  sessions: initialScanSessions,
  researchMode: true,
};

const reducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'scan-completed':
      return {
        ...state,
        latestVitals: action.session.wearableSnapshot,
        sessions: [action.session, ...state.sessions],
      };
    case 'toggle-research-mode':
      return { ...state, researchMode: action.enabled };
    default:
      return state;
  }
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const value = useMemo<AppContextValue>(
    () => ({
      ...state,
      addScanSession: (session) => dispatch({ type: 'scan-completed', session }),
      setResearchMode: (enabled) =>
        dispatch({ type: 'toggle-research-mode', enabled }),
    }),
    [state],
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
