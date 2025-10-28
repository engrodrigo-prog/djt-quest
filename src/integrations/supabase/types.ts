export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      action_evaluations: {
        Row: {
          created_at: string | null
          event_id: string
          feedback_construtivo: string | null
          feedback_positivo: string | null
          id: string
          rating: number | null
          reviewer_id: string
          reviewer_level: Database["public"]["Enums"]["reviewer_level"]
          scores: Json
        }
        Insert: {
          created_at?: string | null
          event_id: string
          feedback_construtivo?: string | null
          feedback_positivo?: string | null
          id?: string
          rating?: number | null
          reviewer_id: string
          reviewer_level: Database["public"]["Enums"]["reviewer_level"]
          scores: Json
        }
        Update: {
          created_at?: string | null
          event_id?: string
          feedback_construtivo?: string | null
          feedback_positivo?: string | null
          id?: string
          rating?: number | null
          reviewer_id?: string
          reviewer_level?: Database["public"]["Enums"]["reviewer_level"]
          scores?: Json
        }
        Relationships: [
          {
            foreignKeyName: "action_evaluations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      badges: {
        Row: {
          created_at: string | null
          criteria: Json | null
          description: string | null
          icon_url: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          criteria?: Json | null
          description?: string | null
          icon_url?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          criteria?: Json | null
          description?: string | null
          icon_url?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          created_at: string | null
          description: string | null
          end_date: string
          id: string
          is_active: boolean | null
          narrative_tag: string | null
          start_date: string
          title: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          end_date: string
          id?: string
          is_active?: boolean | null
          narrative_tag?: string | null
          start_date: string
          title: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          end_date?: string
          id?: string
          is_active?: boolean | null
          narrative_tag?: string | null
          start_date?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      challenges: {
        Row: {
          campaign_id: string | null
          created_at: string | null
          description: string | null
          evidence_required: boolean | null
          id: string
          require_two_leader_eval: boolean | null
          target_coord_ids: string[] | null
          target_dept_ids: string[] | null
          target_div_ids: string[] | null
          target_team_ids: string[] | null
          title: string
          type: Database["public"]["Enums"]["challenge_type"]
          updated_at: string | null
          xp_reward: number | null
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string | null
          description?: string | null
          evidence_required?: boolean | null
          id?: string
          require_two_leader_eval?: boolean | null
          target_coord_ids?: string[] | null
          target_dept_ids?: string[] | null
          target_div_ids?: string[] | null
          target_team_ids?: string[] | null
          title: string
          type: Database["public"]["Enums"]["challenge_type"]
          updated_at?: string | null
          xp_reward?: number | null
        }
        Update: {
          campaign_id?: string | null
          created_at?: string | null
          description?: string | null
          evidence_required?: boolean | null
          id?: string
          require_two_leader_eval?: boolean | null
          target_coord_ids?: string[] | null
          target_dept_ids?: string[] | null
          target_div_ids?: string[] | null
          target_team_ids?: string[] | null
          title?: string
          type?: Database["public"]["Enums"]["challenge_type"]
          updated_at?: string | null
          xp_reward?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "challenges_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      coordinations: {
        Row: {
          created_at: string | null
          division_id: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          division_id: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          division_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "coordinations_division_id_fkey"
            columns: ["division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      divisions: {
        Row: {
          created_at: string | null
          department_id: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          department_id: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          department_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "divisions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      evaluation_queue: {
        Row: {
          assigned_at: string | null
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          event_id: string
          id: string
          is_cross_evaluation: boolean | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          event_id: string
          id?: string
          is_cross_evaluation?: boolean | null
        }
        Update: {
          assigned_at?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          event_id?: string
          id?: string
          is_cross_evaluation?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "evaluation_queue_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          assigned_evaluator_id: string | null
          assignment_type: string | null
          challenge_id: string | null
          created_at: string | null
          eval_multiplier: number | null
          evidence_urls: string[] | null
          final_points: number | null
          id: string
          parent_event_id: string | null
          payload: Json | null
          points_calculated: number | null
          quality_score: number | null
          retry_count: number
          severity_weight: number | null
          status: Database["public"]["Enums"]["event_status"] | null
          team_modifier_applied: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          assigned_evaluator_id?: string | null
          assignment_type?: string | null
          challenge_id?: string | null
          created_at?: string | null
          eval_multiplier?: number | null
          evidence_urls?: string[] | null
          final_points?: number | null
          id?: string
          parent_event_id?: string | null
          payload?: Json | null
          points_calculated?: number | null
          quality_score?: number | null
          retry_count?: number
          severity_weight?: number | null
          status?: Database["public"]["Enums"]["event_status"] | null
          team_modifier_applied?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          assigned_evaluator_id?: string | null
          assignment_type?: string | null
          challenge_id?: string | null
          created_at?: string | null
          eval_multiplier?: number | null
          evidence_urls?: string[] | null
          final_points?: number | null
          id?: string
          parent_event_id?: string | null
          payload?: Json | null
          points_calculated?: number | null
          quality_score?: number | null
          retry_count?: number
          severity_weight?: number | null
          status?: Database["public"]["Enums"]["event_status"] | null
          team_modifier_applied?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_parent_event_id_fkey"
            columns: ["parent_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_attachment_metadata: {
        Row: {
          audio_duration_seconds: number | null
          capture_date: string | null
          created_at: string | null
          device_make: string | null
          device_model: string | null
          file_size: number
          file_type: string
          gps_latitude: number | null
          gps_longitude: number | null
          id: string
          image_height: number | null
          image_width: number | null
          mime_type: string
          ocr_text: string | null
          original_filename: string
          post_id: string | null
          processed_at: string | null
          storage_path: string
          transcription: string | null
        }
        Insert: {
          audio_duration_seconds?: number | null
          capture_date?: string | null
          created_at?: string | null
          device_make?: string | null
          device_model?: string | null
          file_size: number
          file_type: string
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          image_height?: number | null
          image_width?: number | null
          mime_type: string
          ocr_text?: string | null
          original_filename: string
          post_id?: string | null
          processed_at?: string | null
          storage_path: string
          transcription?: string | null
        }
        Update: {
          audio_duration_seconds?: number | null
          capture_date?: string | null
          created_at?: string | null
          device_make?: string | null
          device_model?: string | null
          file_size?: number
          file_type?: string
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          image_height?: number | null
          image_width?: number | null
          mime_type?: string
          ocr_text?: string | null
          original_filename?: string
          post_id?: string | null
          processed_at?: string | null
          storage_path?: string
          transcription?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "forum_attachment_metadata_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_knowledge_base"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "forum_attachment_metadata_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_hashtags: {
        Row: {
          created_at: string | null
          id: string
          tag: string
          usage_count: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          tag: string
          usage_count?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          tag?: string
          usage_count?: number | null
        }
        Relationships: []
      }
      forum_likes: {
        Row: {
          created_at: string | null
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_knowledge_base"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "forum_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_mentions: {
        Row: {
          created_at: string | null
          id: string
          is_read: boolean | null
          mentioned_by: string
          mentioned_user_id: string
          post_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          mentioned_by: string
          mentioned_user_id: string
          post_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          mentioned_by?: string
          mentioned_user_id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_mentions_mentioned_by_fkey"
            columns: ["mentioned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_mentions_mentioned_user_id_fkey"
            columns: ["mentioned_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_mentions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_knowledge_base"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "forum_mentions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_post_hashtags: {
        Row: {
          hashtag_id: string
          post_id: string
        }
        Insert: {
          hashtag_id: string
          post_id: string
        }
        Update: {
          hashtag_id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_post_hashtags_hashtag_id_fkey"
            columns: ["hashtag_id"]
            isOneToOne: false
            referencedRelation: "forum_hashtags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_post_hashtags_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_knowledge_base"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "forum_post_hashtags_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_posts: {
        Row: {
          attachment_urls: string[] | null
          author_id: string
          content: string
          content_html: string | null
          created_at: string | null
          edited_at: string | null
          id: string
          is_edited: boolean | null
          is_featured: boolean | null
          is_solution: boolean | null
          likes_count: number | null
          parent_post_id: string | null
          replies_count: number | null
          reply_to_user_id: string | null
          search_vector: unknown
          topic_id: string
          updated_at: string | null
        }
        Insert: {
          attachment_urls?: string[] | null
          author_id: string
          content: string
          content_html?: string | null
          created_at?: string | null
          edited_at?: string | null
          id?: string
          is_edited?: boolean | null
          is_featured?: boolean | null
          is_solution?: boolean | null
          likes_count?: number | null
          parent_post_id?: string | null
          replies_count?: number | null
          reply_to_user_id?: string | null
          search_vector?: unknown
          topic_id: string
          updated_at?: string | null
        }
        Update: {
          attachment_urls?: string[] | null
          author_id?: string
          content?: string
          content_html?: string | null
          created_at?: string | null
          edited_at?: string | null
          id?: string
          is_edited?: boolean | null
          is_featured?: boolean | null
          is_solution?: boolean | null
          likes_count?: number | null
          parent_post_id?: string | null
          replies_count?: number | null
          reply_to_user_id?: string | null
          search_vector?: unknown
          topic_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "forum_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_posts_parent_post_id_fkey"
            columns: ["parent_post_id"]
            isOneToOne: false
            referencedRelation: "forum_knowledge_base"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "forum_posts_parent_post_id_fkey"
            columns: ["parent_post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_posts_reply_to_user_id_fkey"
            columns: ["reply_to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_posts_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "forum_knowledge_base"
            referencedColumns: ["topic_id"]
          },
          {
            foreignKeyName: "forum_posts_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "forum_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_subscriptions: {
        Row: {
          created_at: string | null
          id: string
          notify_on_reply: boolean | null
          topic_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          notify_on_reply?: boolean | null
          topic_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          notify_on_reply?: boolean | null
          topic_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_subscriptions_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "forum_knowledge_base"
            referencedColumns: ["topic_id"]
          },
          {
            foreignKeyName: "forum_subscriptions_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "forum_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_topics: {
        Row: {
          campaign_id: string | null
          category: string | null
          challenge_id: string | null
          created_at: string | null
          created_by: string
          description: string
          id: string
          is_active: boolean | null
          is_locked: boolean | null
          is_pinned: boolean | null
          last_post_at: string | null
          posts_count: number | null
          target_coord_ids: string[] | null
          target_dept_ids: string[] | null
          target_div_ids: string[] | null
          target_team_ids: string[] | null
          title: string
          updated_at: string | null
          views_count: number | null
        }
        Insert: {
          campaign_id?: string | null
          category?: string | null
          challenge_id?: string | null
          created_at?: string | null
          created_by: string
          description: string
          id?: string
          is_active?: boolean | null
          is_locked?: boolean | null
          is_pinned?: boolean | null
          last_post_at?: string | null
          posts_count?: number | null
          target_coord_ids?: string[] | null
          target_dept_ids?: string[] | null
          target_div_ids?: string[] | null
          target_team_ids?: string[] | null
          title: string
          updated_at?: string | null
          views_count?: number | null
        }
        Update: {
          campaign_id?: string | null
          category?: string | null
          challenge_id?: string | null
          created_at?: string | null
          created_by?: string
          description?: string
          id?: string
          is_active?: boolean | null
          is_locked?: boolean | null
          is_pinned?: boolean | null
          last_post_at?: string | null
          posts_count?: number | null
          target_coord_ids?: string[] | null
          target_dept_ids?: string[] | null
          target_div_ids?: string[] | null
          target_team_ids?: string[] | null
          title?: string
          updated_at?: string | null
          views_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "forum_topics_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_topics_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_topics_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string
          metadata: Json | null
          read: boolean | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          metadata?: Json | null
          read?: boolean | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          metadata?: Json | null
          read?: boolean | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_meta: Json | null
          avatar_thumbnail_url: string | null
          avatar_url: string | null
          coord_id: string | null
          created_at: string | null
          demotion_cooldown_until: string | null
          department_id: string | null
          division_id: string | null
          email: string | null
          id: string
          is_leader: boolean | null
          name: string
          studio_access: boolean | null
          team_id: string | null
          tier: Database["public"]["Enums"]["player_tier"]
          tier_progression_locked: boolean | null
          updated_at: string | null
          xp: number | null
        }
        Insert: {
          avatar_meta?: Json | null
          avatar_thumbnail_url?: string | null
          avatar_url?: string | null
          coord_id?: string | null
          created_at?: string | null
          demotion_cooldown_until?: string | null
          department_id?: string | null
          division_id?: string | null
          email?: string | null
          id: string
          is_leader?: boolean | null
          name: string
          studio_access?: boolean | null
          team_id?: string | null
          tier?: Database["public"]["Enums"]["player_tier"]
          tier_progression_locked?: boolean | null
          updated_at?: string | null
          xp?: number | null
        }
        Update: {
          avatar_meta?: Json | null
          avatar_thumbnail_url?: string | null
          avatar_url?: string | null
          coord_id?: string | null
          created_at?: string | null
          demotion_cooldown_until?: string | null
          department_id?: string | null
          division_id?: string | null
          email?: string | null
          id?: string
          is_leader?: boolean | null
          name?: string
          studio_access?: boolean | null
          team_id?: string | null
          tier?: Database["public"]["Enums"]["player_tier"]
          tier_progression_locked?: boolean | null
          updated_at?: string | null
          xp?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_coord_id_fkey"
            columns: ["coord_id"]
            isOneToOne: false
            referencedRelation: "coordinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_division_id_fkey"
            columns: ["division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_xp_summary"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_options: {
        Row: {
          created_at: string | null
          explanation: string | null
          id: string
          is_correct: boolean
          option_text: string
          question_id: string
        }
        Insert: {
          created_at?: string | null
          explanation?: string | null
          id?: string
          is_correct?: boolean
          option_text: string
          question_id: string
        }
        Update: {
          created_at?: string | null
          explanation?: string | null
          id?: string
          is_correct?: boolean
          option_text?: string
          question_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_options_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "quiz_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_questions: {
        Row: {
          challenge_id: string
          created_at: string | null
          created_by: string
          difficulty_level: string
          id: string
          order_index: number
          question_text: string
          xp_value: number
        }
        Insert: {
          challenge_id: string
          created_at?: string | null
          created_by: string
          difficulty_level: string
          id?: string
          order_index?: number
          question_text: string
          xp_value: number
        }
        Update: {
          challenge_id?: string
          created_at?: string | null
          created_by?: string
          difficulty_level?: string
          id?: string
          order_index?: number
          question_text?: string
          xp_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "quiz_questions_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_incidents: {
        Row: {
          caused_demotion: boolean | null
          created_at: string | null
          description: string
          evidence_urls: string[] | null
          id: string
          incident_type: string
          is_near_miss: boolean | null
          new_tier: Database["public"]["Enums"]["player_tier"] | null
          previous_tier: Database["public"]["Enums"]["player_tier"] | null
          reported_at: string
          reported_by: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          user_id: string
        }
        Insert: {
          caused_demotion?: boolean | null
          created_at?: string | null
          description: string
          evidence_urls?: string[] | null
          id?: string
          incident_type: string
          is_near_miss?: boolean | null
          new_tier?: Database["public"]["Enums"]["player_tier"] | null
          previous_tier?: Database["public"]["Enums"]["player_tier"] | null
          reported_at?: string
          reported_by: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          user_id: string
        }
        Update: {
          caused_demotion?: boolean | null
          created_at?: string | null
          description?: string
          evidence_urls?: string[] | null
          id?: string
          incident_type?: string
          is_near_miss?: boolean | null
          new_tier?: Database["public"]["Enums"]["player_tier"] | null
          previous_tier?: Database["public"]["Enums"]["player_tier"] | null
          reported_at?: string
          reported_by?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      team_events: {
        Row: {
          affected_users: string[]
          created_at: string | null
          created_by: string
          event_type: string
          id: string
          points: number
          reason: string
          team_id: string
        }
        Insert: {
          affected_users: string[]
          created_at?: string | null
          created_by: string
          event_type: string
          id?: string
          points: number
          reason: string
          team_id: string
        }
        Update: {
          affected_users?: string[]
          created_at?: string | null
          created_by?: string
          event_type?: string
          id?: string
          points?: number
          reason?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_xp_summary"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "team_events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_performance_log: {
        Row: {
          created_at: string
          id: string
          new_modifier: number
          previous_modifier: number
          reason: string | null
          team_id: string
          updated_by: string
        }
        Insert: {
          created_at?: string
          id?: string
          new_modifier: number
          previous_modifier: number
          reason?: string | null
          team_id: string
          updated_by: string
        }
        Update: {
          created_at?: string
          id?: string
          new_modifier?: number
          previous_modifier?: number
          reason?: string | null
          team_id?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_performance_log_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_xp_summary"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "team_performance_log_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          coordination_id: string
          created_at: string | null
          id: string
          last_modifier_update: string | null
          modifier_reason: string | null
          name: string
          team_modifier: number | null
        }
        Insert: {
          coordination_id: string
          created_at?: string | null
          id?: string
          last_modifier_update?: string | null
          modifier_reason?: string | null
          name: string
          team_modifier?: number | null
        }
        Update: {
          coordination_id?: string
          created_at?: string | null
          id?: string
          last_modifier_update?: string | null
          modifier_reason?: string | null
          name?: string
          team_modifier?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_coordination_id_fkey"
            columns: ["coordination_id"]
            isOneToOne: false
            referencedRelation: "coordinations"
            referencedColumns: ["id"]
          },
        ]
      }
      tier_demotion_log: {
        Row: {
          cooldown_until: string
          demoted_at: string
          demoted_by: string
          id: string
          incident_id: string | null
          new_tier: Database["public"]["Enums"]["player_tier"]
          previous_tier: Database["public"]["Enums"]["player_tier"]
          reason: string
          user_id: string
        }
        Insert: {
          cooldown_until: string
          demoted_at?: string
          demoted_by: string
          id?: string
          incident_id?: string | null
          new_tier: Database["public"]["Enums"]["player_tier"]
          previous_tier: Database["public"]["Enums"]["player_tier"]
          reason: string
          user_id: string
        }
        Update: {
          cooldown_until?: string
          demoted_at?: string
          demoted_by?: string
          id?: string
          incident_id?: string | null
          new_tier?: Database["public"]["Enums"]["player_tier"]
          previous_tier?: Database["public"]["Enums"]["player_tier"]
          reason?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tier_demotion_log_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "safety_incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      tier_progression_requests: {
        Row: {
          coordinator_id: string | null
          created_at: string
          current_tier: Database["public"]["Enums"]["player_tier"]
          id: string
          review_notes: string | null
          reviewed_at: string | null
          special_challenge_id: string | null
          special_event_id: string | null
          status: Database["public"]["Enums"]["tier_progression_status"]
          target_tier: Database["public"]["Enums"]["player_tier"]
          updated_at: string | null
          user_id: string
        }
        Insert: {
          coordinator_id?: string | null
          created_at?: string
          current_tier: Database["public"]["Enums"]["player_tier"]
          id?: string
          review_notes?: string | null
          reviewed_at?: string | null
          special_challenge_id?: string | null
          special_event_id?: string | null
          status?: Database["public"]["Enums"]["tier_progression_status"]
          target_tier: Database["public"]["Enums"]["player_tier"]
          updated_at?: string | null
          user_id: string
        }
        Update: {
          coordinator_id?: string | null
          created_at?: string
          current_tier?: Database["public"]["Enums"]["player_tier"]
          id?: string
          review_notes?: string | null
          reviewed_at?: string | null
          special_challenge_id?: string | null
          special_event_id?: string | null
          status?: Database["public"]["Enums"]["tier_progression_status"]
          target_tier?: Database["public"]["Enums"]["player_tier"]
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tier_progression_requests_special_challenge_id_fkey"
            columns: ["special_challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_progression_requests_special_event_id_fkey"
            columns: ["special_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      user_badges: {
        Row: {
          badge_id: string
          earned_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          badge_id: string
          earned_at?: string | null
          id?: string
          user_id: string
        }
        Update: {
          badge_id?: string
          earned_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_badges_badge_id_fkey"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "badges"
            referencedColumns: ["id"]
          },
        ]
      }
      user_quiz_answers: {
        Row: {
          answered_at: string | null
          challenge_id: string
          id: string
          is_correct: boolean
          question_id: string
          selected_option_id: string
          user_id: string
          xp_earned: number
        }
        Insert: {
          answered_at?: string | null
          challenge_id: string
          id?: string
          is_correct: boolean
          question_id: string
          selected_option_id: string
          user_id: string
          xp_earned?: number
        }
        Update: {
          answered_at?: string | null
          challenge_id?: string
          id?: string
          is_correct?: boolean
          question_id?: string
          selected_option_id?: string
          user_id?: string
          xp_earned?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_quiz_answers_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_quiz_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "quiz_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_quiz_answers_selected_option_id_fkey"
            columns: ["selected_option_id"]
            isOneToOne: false
            referencedRelation: "quiz_options"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      forum_knowledge_base: {
        Row: {
          author_name: string | null
          author_tier: Database["public"]["Enums"]["player_tier"] | null
          category: string | null
          content: string | null
          content_html: string | null
          created_at: string | null
          hashtags: string[] | null
          is_featured: boolean | null
          is_solution: boolean | null
          likes_count: number | null
          post_id: string | null
          title: string | null
          topic_id: string | null
        }
        Relationships: []
      }
      team_xp_summary: {
        Row: {
          avg_xp: number | null
          collaborator_count: number | null
          max_xp: number | null
          min_xp: number | null
          team_id: string | null
          team_name: string | null
          total_xp: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      calculate_final_points:
        | {
            Args: {
              _base_xp: number
              _eval_multiplier: number
              _quality_score: number
              _retry_count?: number
              _team_modifier: number
            }
            Returns: number
          }
        | {
            Args: {
              _base_xp: number
              _eval_multiplier: number
              _quality_score: number
              _team_modifier: number
            }
            Returns: number
          }
      calculate_tier_from_xp: {
        Args: {
          _current_tier: Database["public"]["Enums"]["player_tier"]
          _xp: number
        }
        Returns: Database["public"]["Enums"]["player_tier"]
      }
      create_notification: {
        Args: {
          _message: string
          _metadata?: Json
          _title: string
          _type: string
          _user_id: string
        }
        Returns: string
      }
      demote_for_safety_incident: {
        Args: {
          _cooldown_days?: number
          _demoted_by: string
          _incident_id: string
          _user_id: string
        }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "colaborador"
        | "coordenador_djtx"
        | "gerente_divisao_djtx"
        | "gerente_djt"
      challenge_type: "quiz" | "mentoria" | "atitude" | "inspecao" | "forum"
      event_status:
        | "submitted"
        | "awaiting_evaluation"
        | "evaluated"
        | "rejected"
        | "retry_pending"
        | "retry_in_progress"
      player_tier:
        | "EX-1"
        | "EX-2"
        | "EX-3"
        | "EX-4"
        | "EX-5"
        | "FO-1"
        | "FO-2"
        | "FO-3"
        | "FO-4"
        | "FO-5"
        | "GU-1"
        | "GU-2"
        | "GU-3"
        | "GU-4"
        | "GU-5"
      reviewer_level: "divisao" | "coordenacao"
      tier_progression_status:
        | "pending"
        | "challenge_created"
        | "in_progress"
        | "under_review"
        | "approved"
        | "rejected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "colaborador",
        "coordenador_djtx",
        "gerente_divisao_djtx",
        "gerente_djt",
      ],
      challenge_type: ["quiz", "mentoria", "atitude", "inspecao", "forum"],
      event_status: [
        "submitted",
        "awaiting_evaluation",
        "evaluated",
        "rejected",
        "retry_pending",
        "retry_in_progress",
      ],
      player_tier: [
        "EX-1",
        "EX-2",
        "EX-3",
        "EX-4",
        "EX-5",
        "FO-1",
        "FO-2",
        "FO-3",
        "FO-4",
        "FO-5",
        "GU-1",
        "GU-2",
        "GU-3",
        "GU-4",
        "GU-5",
      ],
      reviewer_level: ["divisao", "coordenacao"],
      tier_progression_status: [
        "pending",
        "challenge_created",
        "in_progress",
        "under_review",
        "approved",
        "rejected",
      ],
    },
  },
} as const
