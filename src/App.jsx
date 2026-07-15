import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import GoogleAnalyticsTracker from '@/components/GoogleAnalyticsTracker';
import ProtectedRoute from '@/components/ProtectedRoute';

// Auth pages
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';

// App pages
import Landing from '@/pages/Landing';
import Home from '@/pages/Home';
import WalletPage from '@/pages/WalletPage';
import Profile from '@/pages/Profile';
import VerifyMfa from '@/pages/VerifyMfa';
import PrivacyPolicy from '@/pages/PrivacyPolicy';
import PrivacyPolicyAdmin from '@/pages/PrivacyPolicyAdmin';
import TermsOfService from '@/pages/TermsOfService';
import TermsOfServiceAdmin from '@/pages/TermsOfServiceAdmin';
import OfficialRules from '@/pages/OfficialRules';
import OfficialRulesAdmin from '@/pages/OfficialRulesAdmin';
import FairPlayIntegrity from '@/pages/FairPlayIntegrity';
import JoinMatch from '@/pages/JoinMatch';
import IntegrityReviewQueue from '@/pages/IntegrityReviewQueue';
import AdminUserIntegrity from '@/pages/AdminUserIntegrity';
import AdminGameSettings from '@/pages/AdminGameSettings';

// Layout
import AppLayout from '@/components/layout/AppLayout';
import MfaGuard from '@/components/MfaGuard';
import PolicyAcceptanceGuard from '@/components/legal/PolicyAcceptanceGuard';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#0A0A0A]">
        <div className="w-8 h-8 border-4 border-white/10 border-t-[#C9A84C] rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/landing" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/privacy-policy" element={<PrivacyPolicy />} />
      <Route path="/terms-of-service" element={<TermsOfService />} />
      <Route path="/official-rules" element={<OfficialRules />} />
      {/* Handles its own auth/MFA gating so it can return the visitor to this
          exact invitation after they sign in. */}
      <Route path="/join/:inviteCode" element={<JoinMatch />} />

      {/* Protected routes */}
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/landing" replace />} />}>
        <Route path="/verify-mfa" element={<VerifyMfa />} />
        <Route element={<MfaGuard />}>
          <Route element={<PolicyAcceptanceGuard />}>
            <Route path="/admin/privacy-policy" element={<PrivacyPolicyAdmin />} />
            <Route path="/admin/terms-of-service" element={<TermsOfServiceAdmin />} />
            <Route path="/admin/official-rules" element={<OfficialRulesAdmin />} />
            <Route path="/admin/integrity" element={<IntegrityReviewQueue />} />
            <Route path="/admin/integrity/:userId" element={<AdminUserIntegrity />} />
            <Route path="/admin/game-settings" element={<AdminGameSettings />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/wallet" element={<WalletPage />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/fair-play-integrity" element={<FairPlayIntegrity />} />
            </Route>
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <GoogleAnalyticsTracker />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App