import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import Splash from "./pages/Splash";
import Index from "./pages/Index";
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

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/splash" element={<Splash />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/register" element={<Register />} />
            <Route path="/" element={
              <ProtectedRoute>
                <Index />
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
