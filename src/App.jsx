import { lazy, Suspense } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { HelmetProvider } from 'react-helmet-async'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import GoogleAnalyticsTracker from '@/components/GoogleAnalyticsTracker';
import MetaPixelTracker from '@/components/MetaPixelTracker';
import ProtectedRoute from '@/components/ProtectedRoute';

// Keep the public landing page in the initial bundle. Other screens load only
// when visited so marketing visitors do not download account, gameplay, wallet,
// and admin code before seeing the homepage.
import Landing from '@/pages/Landing';
const AboutChessBet = lazy(() => import('@/pages/AboutChessBet'));

const Login = lazy(() => import('@/pages/Login'));
const Register = lazy(() => import('@/pages/Register'));
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'));
const ResetPassword = lazy(() => import('@/pages/ResetPassword'));
const Home = lazy(() => import('@/pages/Home'));
const WalletPage = lazy(() => import('@/pages/WalletPage'));
const Profile = lazy(() => import('@/pages/Profile'));
const VerifyMfa = lazy(() => import('@/pages/VerifyMfa'));
const PrivacyPolicy = lazy(() => import('@/pages/PrivacyPolicy'));
const PrivacyPolicyAdmin = lazy(() => import('@/pages/PrivacyPolicyAdmin'));
const TermsOfService = lazy(() => import('@/pages/TermsOfService'));
const TermsOfServiceAdmin = lazy(() => import('@/pages/TermsOfServiceAdmin'));
const OfficialRules = lazy(() => import('@/pages/OfficialRules'));
const FAQ = lazy(() => import('@/pages/FAQ'));
const Blog = lazy(() => import('@/pages/Blog'));
const OfficialRulesAdmin = lazy(() => import('@/pages/OfficialRulesAdmin'));
const FairPlayIntegrity = lazy(() => import('@/pages/FairPlayIntegrity'));
const Unsubscribe = lazy(() => import('@/pages/Unsubscribe'));
const JoinMatch = lazy(() => import('@/pages/JoinMatch'));
const IntegrityReviewQueue = lazy(() => import('@/pages/IntegrityReviewQueue'));
const AdminUserIntegrity = lazy(() => import('@/pages/AdminUserIntegrity'));
const AdminGameSettings = lazy(() => import('@/pages/AdminGameSettings'));
const DisputeCaseQueue = lazy(() => import('@/pages/DisputeCaseQueue'));
const AdminDisputeCase = lazy(() => import('@/pages/AdminDisputeCase'));
const MyReports = lazy(() => import('@/pages/MyReports'));
const AdminSiteActivity = lazy(() => import('@/pages/AdminSiteActivity'));
const AdminUserFinancials = lazy(() => import('@/pages/AdminUserFinancials'));
const AdminEarlyAccessCampaign = lazy(() => import('@/pages/AdminEarlyAccessCampaign'));
const AdminActionCenter = lazy(() => import('@/pages/AdminActionCenter'));

// Layout
import AppLayout from '@/components/layout/AppLayout';
import MfaGuard from '@/components/MfaGuard';
import AdminGuard from '@/components/AdminGuard';
import PolicyAcceptanceGuard from '@/components/legal/PolicyAcceptanceGuard';

const AuthenticatedApp = () => {
  const { isAuthenticated, isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

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
    <Suspense
      fallback={
        <div className="fixed inset-0 flex items-center justify-center bg-[#0A0A0A]">
          <div className="w-8 h-8 border-4 border-white/10 border-t-[#C9A84C] rounded-full animate-spin"></div>
        </div>
      }
    >
      <Routes>
      {/* Public routes */}
      <Route path="/" element={isAuthenticated ? <Navigate to="/play" replace /> : <Landing />} />
      <Route path="/features" element={<Navigate to="/about#features" replace />} />
      <Route path="/pricing" element={<Navigate to="/about#early-access-and-fees" replace />} />
      <Route path="/about" element={<AboutChessBet />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/privacy-policy" element={<PrivacyPolicy />} />
      <Route path="/terms-of-service" element={<TermsOfService />} />
      <Route path="/official-rules" element={<OfficialRules />} />
      <Route path="/faq" element={<FAQ />} />
      <Route path="/blog" element={<Blog />} />
      <Route path="/fair-play-integrity" element={<FairPlayIntegrity />} />
      <Route path="/unsubscribe" element={<Unsubscribe />} />
      {/* Handles its own auth/MFA gating so it can return the visitor to this
          exact invitation after they sign in. */}
      <Route path="/join/:inviteCode" element={<JoinMatch />} />

      {/* Protected routes */}
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/" replace />} />}>
        <Route path="/verify-mfa" element={<VerifyMfa />} />
        <Route element={<MfaGuard />}>
          <Route element={<PolicyAcceptanceGuard />}>
            <Route element={<AdminGuard />}>
              <Route path="/admin/privacy-policy" element={<PrivacyPolicyAdmin />} />
              <Route path="/admin/terms-of-service" element={<TermsOfServiceAdmin />} />
              <Route path="/admin/official-rules" element={<OfficialRulesAdmin />} />
              <Route path="/admin/actions" element={<AdminActionCenter />} />
              <Route path="/admin/integrity" element={<IntegrityReviewQueue />} />
              <Route path="/admin/integrity/:userId" element={<AdminUserIntegrity />} />
              <Route path="/admin/game-settings" element={<AdminGameSettings />} />
              <Route path="/admin/disputes" element={<DisputeCaseQueue />} />
              <Route path="/admin/disputes/:caseId" element={<AdminDisputeCase />} />
              <Route path="/admin/site-activity" element={<AdminSiteActivity />} />
              <Route path="/admin/user-financials" element={<AdminUserFinancials />} />
              <Route path="/admin/campaigns/early-access-500" element={<AdminEarlyAccessCampaign />} />
            </Route>
            <Route element={<AppLayout />}>
              <Route path="/play" element={<Home />} />
              <Route path="/wallet" element={<WalletPage />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/my-reports" element={<MyReports />} />
            </Route>
          </Route>
        </Route>
      </Route>

        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </Suspense>
  );
};

function App() {
  return (
    <HelmetProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <ScrollToTop />
            <GoogleAnalyticsTracker />
            <MetaPixelTracker />
            <AuthenticatedApp />
          </Router>
          <Toaster />
        </QueryClientProvider>
      </AuthProvider>
    </HelmetProvider>
  )
}

export default App