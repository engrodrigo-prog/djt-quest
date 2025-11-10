-- ================================
-- SISTEMA DE FÓRUM CORPORATIVO
-- ================================

-- 1. TABELA DE TÓPICOS
CREATE TABLE IF NOT EXISTS public.forum_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (LENGTH(title) >= 10 AND LENGTH(title) <= 200),
  description TEXT NOT NULL CHECK (LENGTH(description) >= 50),
  
  created_by UUID REFERENCES profiles(id) NOT NULL,
  
  campaign_id UUID REFERENCES campaigns(id),
  challenge_id UUID REFERENCES challenges(id),
  
  target_team_ids UUID[],
  target_coord_ids UUID[],
  target_div_ids UUID[],
  target_dept_ids UUID[],
  
  category TEXT CHECK (category IN (
    'conhecimento_tecnico', 
    'boas_praticas', 
    'campanhas', 
    'seguranca', 
    'inovacao',
    'duvidas',
    'feedback'
  )),
  
  is_active BOOLEAN DEFAULT TRUE,
  is_pinned BOOLEAN DEFAULT FALSE,
  is_locked BOOLEAN DEFAULT FALSE,
  
  views_count INTEGER DEFAULT 0,
  posts_count INTEGER DEFAULT 0,
  last_post_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_topics_active ON public.forum_topics(is_active, is_pinned, last_post_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_topics_category ON public.forum_topics(category);
ALTER TABLE public.forum_topics ENABLE ROW LEVEL SECURITY;

-- 2. TABELA DE POSTS
CREATE TABLE IF NOT EXISTS public.forum_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID REFERENCES forum_topics(id) ON DELETE CASCADE NOT NULL,
  author_id UUID REFERENCES profiles(id) NOT NULL,
  
  content TEXT NOT NULL CHECK (LENGTH(content) >= 10),
  content_html TEXT,
  
  attachment_urls TEXT[],
  
  parent_post_id UUID REFERENCES forum_posts(id) ON DELETE CASCADE,
  reply_to_user_id UUID REFERENCES profiles(id),
  
  is_solution BOOLEAN DEFAULT FALSE,
  is_featured BOOLEAN DEFAULT FALSE,
  is_edited BOOLEAN DEFAULT FALSE,
  edited_at TIMESTAMPTZ,
  
  likes_count INTEGER DEFAULT 0,
  replies_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_posts_topic ON public.forum_posts(topic_id, created_at);
CREATE INDEX IF NOT EXISTS idx_forum_posts_parent ON public.forum_posts(parent_post_id);
ALTER TABLE public.forum_posts ENABLE ROW LEVEL SECURITY;

-- 3. TABELA DE MENÇÕES
CREATE TABLE IF NOT EXISTS public.forum_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES forum_posts(id) ON DELETE CASCADE NOT NULL,
  mentioned_user_id UUID REFERENCES profiles(id) NOT NULL,
  mentioned_by UUID REFERENCES profiles(id) NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (post_id, mentioned_user_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_mentions_user ON public.forum_mentions(mentioned_user_id, is_read);
ALTER TABLE public.forum_mentions ENABLE ROW LEVEL SECURITY;

-- 4. TABELA DE HASHTAGS
CREATE TABLE IF NOT EXISTS public.forum_hashtags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag TEXT NOT NULL UNIQUE CHECK (LENGTH(tag) >= 3 AND LENGTH(tag) <= 50),
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.forum_post_hashtags (
  post_id UUID REFERENCES forum_posts(id) ON DELETE CASCADE NOT NULL,
  hashtag_id UUID REFERENCES forum_hashtags(id) ON DELETE CASCADE NOT NULL,
  PRIMARY KEY (post_id, hashtag_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_hashtags_usage ON public.forum_hashtags(usage_count DESC);
ALTER TABLE public.forum_hashtags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_post_hashtags ENABLE ROW LEVEL SECURITY;

-- 5. TABELA DE CURTIDAS
CREATE TABLE IF NOT EXISTS public.forum_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES forum_posts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (post_id, user_id)
);

ALTER TABLE public.forum_likes ENABLE ROW LEVEL SECURITY;

-- 6. TABELA DE INSCRIÇÕES
CREATE TABLE IF NOT EXISTS public.forum_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID REFERENCES forum_topics(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  notify_on_reply BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (topic_id, user_id)
);

ALTER TABLE public.forum_subscriptions ENABLE ROW LEVEL SECURITY;

-- 7. VIEW DE CONHECIMENTO
CREATE OR REPLACE VIEW public.forum_knowledge_base AS
SELECT 
  ft.id AS topic_id,
  ft.title,
  ft.category,
  ft.created_at,
  
  fp.id AS post_id,
  fp.content,
  fp.content_html,
  fp.is_solution,
  fp.is_featured,
  fp.likes_count,
  
  p.name AS author_name,
  p.tier AS author_tier,
  
  ARRAY_AGG(DISTINCT fh.tag) FILTER (WHERE fh.tag IS NOT NULL) AS hashtags
  
FROM public.forum_topics ft
JOIN public.forum_posts fp ON fp.topic_id = ft.id
JOIN public.profiles p ON p.id = fp.author_id
LEFT JOIN public.forum_post_hashtags fph ON fph.post_id = fp.id
LEFT JOIN public.forum_hashtags fh ON fh.id = fph.hashtag_id

WHERE ft.is_active = TRUE 
  AND (fp.is_solution = TRUE OR fp.is_featured = TRUE OR fp.likes_count >= 5)

GROUP BY ft.id, ft.title, ft.category, ft.created_at, 
         fp.id, fp.content, fp.content_html, fp.is_solution, 
         fp.is_featured, fp.likes_count, p.name, p.tier

ORDER BY fp.is_solution DESC, fp.likes_count DESC;

-- 8. TRIGGERS
CREATE OR REPLACE FUNCTION increment_topic_post_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE forum_topics 
  SET posts_count = posts_count + 1,
      last_post_at = NOW()
  WHERE id = NEW.topic_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS after_forum_post_insert ON public.forum_posts;
CREATE TRIGGER after_forum_post_insert
AFTER INSERT ON public.forum_posts
FOR EACH ROW
EXECUTE FUNCTION increment_topic_post_count();

CREATE OR REPLACE FUNCTION increment_post_likes()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE forum_posts 
  SET likes_count = likes_count + 1
  WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS after_forum_like_insert ON public.forum_likes;
CREATE TRIGGER after_forum_like_insert
AFTER INSERT ON public.forum_likes
FOR EACH ROW
EXECUTE FUNCTION increment_post_likes();

CREATE OR REPLACE FUNCTION increment_hashtag_usage()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE forum_hashtags 
  SET usage_count = usage_count + 1
  WHERE id = NEW.hashtag_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS after_post_hashtag_insert ON public.forum_post_hashtags;
CREATE TRIGGER after_post_hashtag_insert
AFTER INSERT ON public.forum_post_hashtags
FOR EACH ROW
EXECUTE FUNCTION increment_hashtag_usage();

-- 9. RLS POLICIES - forum_topics
DROP POLICY IF EXISTS "Leaders can create topics" ON public.forum_topics;
CREATE POLICY "Leaders can create topics"
ON public.forum_topics FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = (select auth.uid()) AND studio_access = TRUE)
);

DROP POLICY IF EXISTS "Users can view targeted topics" ON public.forum_topics;
CREATE POLICY "Users can view targeted topics"
ON public.forum_topics FOR SELECT
USING (
  is_active = TRUE AND (
    target_team_ids IS NULL OR
    target_coord_ids IS NULL OR
    target_div_ids IS NULL OR
    target_dept_ids IS NULL OR
    (select auth.uid()) IN (
      SELECT id FROM public.profiles 
      WHERE 
        (team_id::text = ANY(target_team_ids::text[]) OR target_team_ids IS NULL) AND
        (coord_id::text = ANY(target_coord_ids::text[]) OR target_coord_ids IS NULL) AND
        (division_id::text = ANY(target_div_ids::text[]) OR target_div_ids IS NULL) AND
        (department_id::text = ANY(target_dept_ids::text[]) OR target_dept_ids IS NULL)
    )
  )
);

DROP POLICY IF EXISTS "Leaders can moderate topics" ON public.forum_topics;
CREATE POLICY "Leaders can moderate topics"
ON public.forum_topics FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = (select auth.uid()) AND studio_access = TRUE)
);

-- 10. RLS POLICIES - forum_posts
DROP POLICY IF EXISTS "Users can create posts" ON public.forum_posts;
CREATE POLICY "Users can create posts"
ON public.forum_posts FOR INSERT
WITH CHECK (
  author_id = (select auth.uid()) AND
  EXISTS (
    SELECT 1 FROM public.forum_topics 
    WHERE id = topic_id AND is_active = TRUE AND is_locked = FALSE
  )
);

DROP POLICY IF EXISTS "Users can view posts" ON public.forum_posts;
CREATE POLICY "Users can view posts"
ON public.forum_posts FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.forum_topics ft
    WHERE ft.id = topic_id AND ft.is_active = TRUE
  )
);

DROP POLICY IF EXISTS "Users can edit own posts" ON public.forum_posts;
CREATE POLICY "Users can edit own posts"
ON public.forum_posts FOR UPDATE
USING (
  author_id = (select auth.uid()) AND
  created_at > NOW() - INTERVAL '24 hours'
);

DROP POLICY IF EXISTS "Leaders can moderate posts" ON public.forum_posts;
CREATE POLICY "Leaders can moderate posts"
ON public.forum_posts FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = (select auth.uid()) AND studio_access = TRUE)
);

-- 11. RLS POLICIES - outras tabelas
DROP POLICY IF EXISTS "Users can view own mentions" ON public.forum_mentions;
CREATE POLICY "Users can view own mentions"
ON public.forum_mentions FOR SELECT
USING (mentioned_user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can like posts" ON public.forum_likes;
CREATE POLICY "Users can like posts"
ON public.forum_likes FOR INSERT
WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can view likes" ON public.forum_likes;
CREATE POLICY "Users can view likes"
ON public.forum_likes FOR SELECT
USING (TRUE);

DROP POLICY IF EXISTS "Users manage own subscriptions" ON public.forum_subscriptions;
CREATE POLICY "Users manage own subscriptions"
ON public.forum_subscriptions FOR ALL
USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Anyone can view hashtags" ON public.forum_hashtags;
CREATE POLICY "Anyone can view hashtags"
ON public.forum_hashtags FOR SELECT
USING (TRUE);

DROP POLICY IF EXISTS "Anyone can view post hashtags" ON public.forum_post_hashtags;
CREATE POLICY "Anyone can view post hashtags"
ON public.forum_post_hashtags FOR SELECT
USING (TRUE);

-- 12. Adicionar coluna de busca full-text
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='forum_posts' AND column_name='search_vector'
  ) THEN
    ALTER TABLE public.forum_posts 
    ADD COLUMN search_vector tsvector 
    GENERATED ALWAYS AS (
      to_tsvector('portuguese', coalesce(content, ''))
    ) STORED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_forum_posts_search ON public.forum_posts USING GIN(search_vector);
