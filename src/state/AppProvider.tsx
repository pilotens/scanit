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
import type {
  ConsentRecord,
  HealthKitConnectionStatus,
  HealthKitImportRecord,
  UserProfile,
} from '@/domain/onboarding';
import type { ScanSession } from '@/domain/scanning';
import {
  isHealthKitSupported,
  requestAndImportHealthKit,
} from '@/services/healthkit/healthKitService';
import { appStateRepository } from '@/services/storage/appStateRepository';
import type { StorageDescriptor } from '@/services/storage/types';

type PersistenceStatus = 'loading' | 'ready' | 'error';

type AppState = {
  latestVitals: VitalSnapshot;
  baseline: PersonalBaseline;
  sensors: SensorConnection[];
  sessions: ScanSession[];
  researchMode: boolean;
  profile?: UserProfile;
  consent?: ConsentRecord;
  healthKitImport?: HealthKitImportRecord;
  healthKitStatus: HealthKitConnectionStatus;
  healthKitError?: string;
  isHydrated: boolean;
  persistenceStatus: PersistenceStatus;
  persistenceError?: string;
};

type AppAction =
  | {
      type: 'hydrate';
      sessions: ScanSession[];
      researchMode?: boolean;
      profile?: UserProfile;
      consent?: ConsentRecord;
      healthKitImport?: HealthKitImportRecord;
    }
  | { type: 'scan-completed'; session: ScanSession }
  | { type: 'toggle-research-mode'; enabled: boolean }
  | { type: 'onboarding-completed'; profile: UserProfile; consent: ConsentRecord }
  | { type: 'healthkit-status'; status: HealthKitConnectionStatus }
  | { type: 'healthkit-imported'; healthKitImport: HealthKitImportRecord }
  | { type: 'healthkit-error'; message: string }
  | { type: 'persistence-error'; message: string }
  | { type: 'clear-local-data' };

type AppContextValue = AppState & {
  storage: StorageDescriptor;
  onboardingComplete: boolean;
  healthKitSupported: boolean;
  addScanSession: (session: ScanSession) => void;
  setResearchMode: (enabled: boolean) => void;
  completeOnboarding: (profile: UserProfile, consent: ConsentRecord) => Promise<void>;
  connectAndImportHealthKit: () => Promise<HealthKitImportRecord>;
  clearLocalData: () => Promise<void>;
};

const healthKitSupportedAtStartup = isHealthKitSupported();

const initialState: AppState = {
  latestVitals: currentVitals,
  baseline: personalBaseline,
  sensors: initialSensors,
  sessions: initialScanSessions,
  researchMode: true,
  healthKitStatus: healthKitSupportedAtStartup ? 'idle' : 'unsupported',
  isHydrated: false,
  persistenceStatus: 'loading',
};

const reducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'hydrate': {
      const sessions = action.sessions.length > 0 ? action.sessions : state.sessions;
      const latestVitals =
        action.healthKitImport?.vitalSnapshot ??
        sessions[0]?.wearableSnapshot ??
        state.latestVitals;
      return {
        ...state,
        latestVitals,
        sessions,
        researchMode: action.researchMode ?? state.researchMode,
        profile: action.profile,
        consent: action.consent,
        healthKitImport: action.healthKitImport,
        healthKitStatus: action.healthKitImport
          ? 'ready'
          : healthKitSupportedAtStartup
            ? 'idle'
            : 'unsupported',
        healthKitError: undefined,
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
    case 'onboarding-completed':
      return { ...state, profile: action.profile, consent: action.consent };
    case 'healthkit-status':
      return { ...state, healthKitStatus: action.status, healthKitError: undefined };
    case 'healthkit-imported':
      return {
        ...state,
        latestVitals: action.healthKitImport.vitalSnapshot,
        healthKitImport: action.healthKitImport,
        healthKitStatus: 'ready',
        healthKitError: undefined,
      };
    case 'healthkit-error':
      return { ...state, healthKitStatus: 'error', healthKitError: action.message };
    case 'persistence-error':
      return {
        ...state,
        isHydrated: true,
        persistenceStatus: 'error',
        persistenceError: action.message,
      };
    case 'clear-local-data':
      return {
        ...initialState,
        sessions: [],
        isHydrated: true,
        persistenceStatus: 'ready',
      };
    default:
      return state;
  }
};

const AppContext = createContext<AppContextValue | null>(null);

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Okänt fel.';

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
            profile: persistedState.profile,
            consent: persistedState.consent,
            healthKitImport: persistedState.healthKitImport,
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

  const completeOnboarding = useCallback(
    async (profile: UserProfile, consent: ConsentRecord) => {
      try {
        await appStateRepository.saveOnboarding(profile, consent);
        dispatch({ type: 'onboarding-completed', profile, consent });
      } catch (error) {
        reportPersistenceError(error);
        throw error;
      }
    },
    [reportPersistenceError],
  );

  const connectAndImportHealthKit = useCallback(async () => {
    if (!healthKitSupportedAtStartup) {
      const error = new Error(
        'Apple Health är inte tillgängligt i den här appversionen eller på den här enheten.',
      );
      dispatch({ type: 'healthkit-error', message: error.message });
      throw error;
    }
    if (!state.profile || !state.consent) {
      const error = new Error('Slutför introduktionen innan Apple Health ansluts.');
      dispatch({ type: 'healthkit-error', message: error.message });
      throw error;
    }

    const consent: ConsentRecord = {
      ...state.consent,
      acceptedAt: new Date().toISOString(),
      healthKitReadAccepted: true,
    };

    dispatch({ type: 'healthkit-status', status: 'authorizing' });
    try {
      await appStateRepository.saveOnboarding(state.profile, consent);
      dispatch({ type: 'onboarding-completed', profile: state.profile, consent });
      dispatch({ type: 'healthkit-status', status: 'importing' });
      const healthKitImport = await requestAndImportHealthKit();
      await appStateRepository.saveHealthKitImport(healthKitImport);
      dispatch({ type: 'healthkit-imported', healthKitImport });
      return healthKitImport;
    } catch (error) {
      dispatch({ type: 'healthkit-error', message: toErrorMessage(error) });
      throw error;
    }
  }, [state.consent, state.profile]);

  const clearLocalData = useCallback(async () => {
    try {
      await appStateRepository.clear();
      dispatch({ type: 'clear-local-data' });
    } catch (error) {
      reportPersistenceError(error);
      throw error;
    }
  }, [reportPersistenceError]);

  const onboardingComplete = Boolean(
    state.profile &&
      state.consent?.researchPrototypeAccepted &&
      state.consent.encryptedLocalStorageAccepted,
  );

  const value = useMemo<AppContextValue>(
    () => ({
      ...state,
      storage: appStateRepository.descriptor,
      onboardingComplete,
      healthKitSupported: healthKitSupportedAtStartup,
      addScanSession,
      setResearchMode,
      completeOnboarding,
      connectAndImportHealthKit,
      clearLocalData,
    }),
    [
      addScanSession,
      clearLocalData,
      completeOnboarding,
      connectAndImportHealthKit,
      onboardingComplete,
      setResearchMode,
      state,
    ],
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
