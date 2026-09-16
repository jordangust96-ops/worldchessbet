import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';
import { createAxiosClient } from '@base44/sdk/dist/utils/axios-client';
import { clearMfaVerified } from '@/lib/mfaSession';
import { trackCompletedOAuthLogin } from '@/lib/googleAnalytics';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings, setAppPublicSettings] = useState(null); // Contains only { id, public_settings }
  // This is the most recently persisted jurisdiction result and is display
  // context only. Fresh enforcement happens server-side at funding and
  // contest-participation boundaries, never during ordinary login/navigation.
  const [jurisdictionStatus, setJurisdictionStatus] = useState(null);
  const [jurisdictionReason, setJurisdictionReason] = useState('');
  const authRetryTimerRef = useRef(null);

  useEffect(() => {
    checkAppState();
    return () => {
      if (authRetryTimerRef.current) window.clearTimeout(authRetryTimerRef.current);
    };
  }, []);

  const checkAppState = async () => {
    try {
      setIsLoadingPublicSettings(true);
      setAuthError(null);
      
      // First, check app public settings (with token if available)
      // This will tell us if auth is required, user not registered, etc.
      const appClient = createAxiosClient({
        baseURL: `/api/apps/public`,
        headers: {
          'X-App-Id': appParams.appId
        },
        token: appParams.token, // Include token if available
        interceptResponses: true
      });
      
      try {
        const publicSettings = await appClient.get(`/prod/public-settings/by-id/${appParams.appId}`);
        setAppPublicSettings(publicSettings);
        
        // If we got the app public settings successfully, check if user is authenticated
        if (appParams.token) {
          await checkUserAuth();
        } else {
          setIsLoadingAuth(false);
          setIsAuthenticated(false);
          setAuthChecked(true);
        }
        setIsLoadingPublicSettings(false);
      } catch (appError) {
        console.error('App state check failed:', appError);
        
        // Handle app-level errors
        if (appError.status === 403 && appError.data?.extra_data?.reason) {
          const reason = appError.data.extra_data.reason;
          if (reason === 'auth_required') {
            setAuthError({
              type: 'auth_required',
              message: 'Authentication required'
            });
          } else if (reason === 'user_not_registered') {
            setAuthError({
              type: 'user_not_registered',
              message: 'User not registered for this app'
            });
          } else {
            setAuthError({
              type: reason,
              message: appError.message
            });
          }
        } else {
          setAuthError({
            type: 'unknown',
            message: appError.message || 'Failed to load app'
          });
        }
        setIsLoadingPublicSettings(false);
        setIsLoadingAuth(false);
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      setAuthError({
        type: 'unknown',
        message: error.message || 'An unexpected error occurred'
      });
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
    }
  };

  const checkUserAuth = async (retryAttempt = 0) => {
    if (authRetryTimerRef.current) {
      window.clearTimeout(authRetryTimerRef.current);
      authRetryTimerRef.current = null;
    }
    try {
      // A transient network failure must not turn an active game session into
      // a false logout. Keep the protected app in its reconnecting state until
      // auth succeeds or the server explicitly rejects the session.
      setIsLoadingAuth(true);
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      setAuthError(null);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      trackCompletedOAuthLogin();

      // Fire-and-forget: send the one-time Welcome Email for brand-new accounts.
      // The function itself is idempotent (checks welcome_email_sent), so this
      // is safe to call on every auth check without ever resending.
      if (currentUser && !currentUser.welcome_email_sent) {
        base44.functions.invoke('sendWelcomeEmail', { userId: currentUser.id }).catch(() => {});
      }

      // Ordinary login/navigation must not surface or enforce a stale persisted
      // jurisdiction result. Location is checked only at explicit protected
      // boundaries (wallet onboarding before identity verification, and paid
      // match participation) where the server performs the authoritative check.
      setJurisdictionStatus(null);
      setJurisdictionReason('');
    } catch (error) {
      console.error('User auth check failed:', error);
      const status = error?.status ?? error?.response?.status;
      if (status === 401 || status === 403) {
        setUser(null);
        setIsLoadingAuth(false);
        setIsAuthenticated(false);
        setAuthChecked(true);
        setAuthError({
          type: 'auth_required',
          message: 'Authentication required'
        });
        return;
      }

      // Network/5xx failures are not evidence that the token is invalid.
      // Retry with bounded backoff while the global loading screen keeps the
      // live route mounted as reconnecting rather than redirecting to login.
      setAuthError(null);
      setIsLoadingAuth(true);
      setAuthChecked(false);
      const delay = Math.min(1000 * (2 ** Math.min(retryAttempt, 3)), 8000);
      authRetryTimerRef.current = window.setTimeout(() => {
        authRetryTimerRef.current = null;
        void checkUserAuth(retryAttempt + 1);
      }, delay);
    }
  };

  const logout = (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    clearMfaVerified();
    
    if (shouldRedirect) {
      // Use the SDK's logout method which handles token cleanup and redirect
      base44.auth.logout(window.location.href);
    } else {
      // Just remove the token without redirect
      base44.auth.logout();
    }
  };

  const navigateToLogin = () => {
    // Use the SDK's redirectToLogin method
    base44.auth.redirectToLogin(window.location.href);
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated, 
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      authChecked,
      jurisdictionStatus,
      jurisdictionReason,
      logout,
      navigateToLogin,
      checkUserAuth,
      checkAppState
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};