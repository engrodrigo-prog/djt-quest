-- Create enums for type safety
CREATE TYPE public.app_role AS ENUM ('admin', 'gerente', 'lider_divisao', 'coordenador', 'colaborador');
CREATE TYPE public.challenge_type AS ENUM ('quiz', 'mentoria', 'atitude', 'inspecao', 'forum');
CREATE TYPE public.event_status AS ENUM ('submitted', 'awaiting_evaluation', 'evaluated', 'rejected');
CREATE TYPE public.reviewer_level AS ENUM ('divisao', 'coordenacao');

-- Departments (top level)
CREATE TABLE public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Divisions (belong to departments)
CREATE TABLE public.divisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID REFERENCES public.departments(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Coordinations (belong to divisions)
CREATE TABLE public.coordinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID REFERENCES public.divisions(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Teams (belong to coordinations)
CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coordination_id UUID REFERENCES public.coordinations(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  name TEXT NOT NULL,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  avatar_meta JSONB DEFAULT '{}',
  xp INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User roles (secure role management)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE(user_id, role)
);

-- Security definer function to check roles (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Campaigns (LiveOps)
CREATE TABLE public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  narrative_tag TEXT,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Challenges (activities within campaigns)
CREATE TABLE public.challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
  type challenge_type NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  xp_reward INTEGER DEFAULT 0,
  require_two_leader_eval BOOLEAN DEFAULT FALSE,
  evidence_required BOOLEAN DEFAULT FALSE,
  target_team_ids UUID[],
  target_coord_ids UUID[],
  target_div_ids UUID[],
  target_dept_ids UUID[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Events (user actions/submissions)
CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  challenge_id UUID REFERENCES public.challenges(id) ON DELETE CASCADE,
  payload JSONB DEFAULT '{}',
  evidence_urls TEXT[],
  quality_score DECIMAL(3,2),
  severity_weight DECIMAL(3,2),
  eval_multiplier DECIMAL(3,2) DEFAULT 1.0,
  points_calculated INTEGER DEFAULT 0,
  status event_status DEFAULT 'submitted',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Action evaluations (2-leader system)
CREATE TABLE public.action_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE NOT NULL,
  reviewer_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  reviewer_level reviewer_level NOT NULL,
  scores JSONB NOT NULL,
  rating DECIMAL(2,1) CHECK (rating >= 1.0 AND rating <= 5.0),
  feedback_positivo TEXT,
  feedback_construtivo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, reviewer_id),
  CONSTRAINT feedback_required CHECK (
    LENGTH(COALESCE(feedback_positivo, '')) >= 140 OR 
    LENGTH(COALESCE(feedback_construtivo, '')) >= 140
  )
);

-- Badges
CREATE TABLE public.badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  icon_url TEXT,
  criteria JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User badges
CREATE TABLE public.user_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  badge_id UUID REFERENCES public.badges(id) ON DELETE CASCADE NOT NULL,
  earned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, badge_id)
);

-- Enable RLS
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coordinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- RLS Policies for user_roles
CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for organizational structure (readable by all authenticated)
CREATE POLICY "All can view departments"
  ON public.departments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "All can view divisions"
  ON public.divisions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "All can view coordinations"
  ON public.coordinations FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "All can view teams"
  ON public.teams FOR SELECT
  TO authenticated
  USING (true);

-- RLS Policies for campaigns
CREATE POLICY "All can view active campaigns"
  ON public.campaigns FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Admins and gerentes can manage campaigns"
  ON public.campaigns FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

-- RLS Policies for challenges
CREATE POLICY "All can view challenges"
  ON public.challenges FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins and leaders can create challenges"
  ON public.challenges FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'gerente') OR
    public.has_role(auth.uid(), 'lider_divisao') OR
    public.has_role(auth.uid(), 'coordenador')
  );

-- RLS Policies for events
CREATE POLICY "Users can view own events"
  ON public.events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Leaders can view events in their area"
  ON public.events FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'gerente') OR
    public.has_role(auth.uid(), 'lider_divisao') OR
    public.has_role(auth.uid(), 'coordenador')
  );

CREATE POLICY "Users can create events"
  ON public.events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for action_evaluations
CREATE POLICY "Users can view evaluations for own events"
  ON public.action_evaluations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events 
      WHERE events.id = action_evaluations.event_id 
      AND events.user_id = auth.uid()
    )
  );

CREATE POLICY "Leaders can view evaluations"
  ON public.action_evaluations FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'gerente') OR
    public.has_role(auth.uid(), 'lider_divisao') OR
    public.has_role(auth.uid(), 'coordenador')
  );

CREATE POLICY "Leaders can create evaluations"
  ON public.action_evaluations FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = reviewer_id AND (
      public.has_role(auth.uid(), 'lider_divisao') OR
      public.has_role(auth.uid(), 'coordenador')
    )
  );

-- RLS Policies for badges
CREATE POLICY "All can view badges"
  ON public.badges FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "All can view user badges"
  ON public.user_badges FOR SELECT
  TO authenticated
  USING (true);

-- Trigger function for profile creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (
    NEW.id, 
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email)
  );
  
  -- Assign default colaborador role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'colaborador');
  
  RETURN NEW;
END;
$$;

-- Trigger for automatic profile creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update updated_at timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Triggers for updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_challenges_updated_at
  BEFORE UPDATE ON public.challenges
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();