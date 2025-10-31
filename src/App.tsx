import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { StudioWelcomeToast } from "@/components/StudioWelcomeToast";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { CompleteProfile } from "./components/CompleteProfile";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import Auth from "./pages/Auth";
import Register from "./pages/Register";
import NotFound from "./pages/NotFound";
import ChallengeDetail from "./pages/ChallengeDetail";
import Evaluations from "./pages/Evaluations";
import Studio from "./pages/Studio";
import Profile from "./pages/Profile";
import Rankings from "./pages/Rankings";
import Forums from "./pages/Forums";
import ForumTopic from "./pages/ForumTopic";
import UserSetup from "./pages/UserSetup";

const queryClient = new QueryClient();

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
      <BrowserRouter>
        <AuthProvider>
          <StudioWelcomeToast />
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
            <Route path="/evaluations" element={
              <ProtectedRoute>
                <Evaluations />
              </ProtectedRoute>
            } />
            <Route path="/studio" element={
              <ProtectedRoute requireStudio>
                <Studio />
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
            <Route path="/forum/:topicId" element={
              <ProtectedRoute>
                <ForumTopic />
              </ProtectedRoute>
            } />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
