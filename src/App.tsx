import React, { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { StudioWelcomeToast } from "@/components/StudioWelcomeToast";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { I18nProvider } from "./contexts/I18nContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { CompleteProfile } from "./components/CompleteProfile";
import { STUDIO_ALLOWED_ROLES } from "../shared/rbac.js";
const Home = lazy(() => import("./pages/Home"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Auth = lazy(() => import("./pages/Auth"));
const Register = lazy(() => import("./pages/Register"));
const NotFound = lazy(() => import("./pages/NotFound"));
const ChallengeDetail = lazy(() => import("./pages/ChallengeDetail"));
const Evaluations = lazy(() => import("./pages/Evaluations"));
const Studio = lazy(() => import("./pages/Studio"));
const StudioCuration = lazy(() => import("./pages/StudioCuration"));
const Profile = lazy(() => import("./pages/Profile"));
const Rankings = lazy(() => import("./pages/Rankings"));
const Forums = lazy(() => import("./pages/Forums"));
const ForumTopic = lazy(() => import("./pages/ForumTopic"));
const ForumInsights = lazy(() => import("./pages/ForumInsights"));
const UserSetup = lazy(() => import("./pages/UserSetup"));
const LeaderDashboard = lazy(() => import("./pages/LeaderDashboard"));
const SEPBook = lazy(() => import("./pages/SEPBook"));
const CampaignDetail = lazy(() => import("./pages/CampaignDetail"));
const Study = lazy(() => import("./pages/Study"));

const queryClient = new QueryClient();
// Compat: inclui roles legados (gerente/coordenador/lider_divisao) além dos atuais.
const LEADER_ALLOWED_ROLES = [
  'coordenador_djtx',
  'gerente_divisao_djtx',
  'gerente_djt',
  'admin',
  'coordenador',
  'lider_divisao',
  'gerente',
  'lider_equipe',
];

const ProfileCheckWrapper = ({ children }: { children: React.ReactNode }) => {
  const { profile, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Carregando...</div>;
  }

  if (profile && (profile.must_change_password || profile.needs_profile_completion)) {
    return <CompleteProfile profile={profile} />;
  }

  return <>{children}</>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <I18nProvider>
            <StudioWelcomeToast />
            <Suspense
              fallback={
                <div className="min-h-screen flex items-center justify-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
                </div>
              }
            >
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/register" element={<Register />} />
              <Route path="/user-setup" element={<UserSetup />} />
            <Route path="/" element={<Home />} />
              <Route path="/dashboard" element={
                <ProtectedRoute>
                  <ProfileCheckWrapper>
                    <Dashboard />
                  </ProfileCheckWrapper>
                </ProtectedRoute>
              } />
              <Route path="/challenge/:id" element={
                <ProtectedRoute>
                  <ChallengeDetail />
                </ProtectedRoute>
              } />
              <Route path="/campaign/:campaignId" element={
                <ProtectedRoute>
                  <CampaignDetail />
                </ProtectedRoute>
              } />
              <Route path="/evaluations" element={
                <ProtectedRoute requireLeader allowedRoles={LEADER_ALLOWED_ROLES}>
                  <Evaluations />
                </ProtectedRoute>
              } />
              <Route path="/studio" element={
                <ProtectedRoute requireStudio allowedRoles={STUDIO_ALLOWED_ROLES}>
                  <Studio />
                </ProtectedRoute>
              } />
              <Route path="/studio/curadoria" element={
                <ProtectedRoute requireStudio allowedRoles={STUDIO_ALLOWED_ROLES}>
                  <StudioCuration />
                </ProtectedRoute>
              } />
              <Route path="/leader-dashboard" element={
                <ProtectedRoute requireLeader allowedRoles={LEADER_ALLOWED_ROLES}>
                  <LeaderDashboard />
                </ProtectedRoute>
              } />
              <Route path="/profile" element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              } />
              <Route path="/rankings" element={
                <ProtectedRoute>
                  <Rankings />
                </ProtectedRoute>
              } />
              <Route path="/forums" element={
                <ProtectedRoute>
                  <Forums />
                </ProtectedRoute>
              } />
              <Route path="/forums/insights" element={
                <ProtectedRoute>
                  <ForumInsights />
                </ProtectedRoute>
              } />
              <Route path="/sepbook" element={
                <ProtectedRoute>
                  <SEPBook />
                </ProtectedRoute>
              } />
              <Route path="/study" element={
                <ProtectedRoute>
                  <Study />
                </ProtectedRoute>
              } />
              <Route path="/forum/:topicId" element={
                <ProtectedRoute>
                  <ForumTopic />
                </ProtectedRoute>
              } />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
          </I18nProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
