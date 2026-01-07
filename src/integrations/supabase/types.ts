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
          evaluation_number: number | null
          event_id: string
          feedback_construtivo: string | null
          feedback_positivo: string | null
          final_rating: number | null
          id: string
          rating: number | null
          reviewer_id: string
          reviewer_level: Database["public"]["Enums"]["reviewer_level"]
          scores: Json
        }
        Insert: {
          created_at?: string | null
          evaluation_number?: number | null
          event_id: string
          feedback_construtivo?: string | null
          feedback_positivo?: string | null
          final_rating?: number | null
          id?: string
          rating?: number | null
          reviewer_id: string
          reviewer_level: Database["public"]["Enums"]["reviewer_level"]
          scores: Json
        }
        Update: {
          created_at?: string | null
          evaluation_number?: number | null
          event_id?: string
          feedback_construtivo?: string | null
          feedback_positivo?: string | null
          final_rating?: number | null
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
          {
            foreignKeyName: "action_evaluations_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          approved_at: string | null
          approved_by: string | null
          campaign_id: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          evidence_required: boolean | null
          id: string
          owner_id: string | null
          published_at: string | null
          published_by: string | null
          quiz_workflow_status: Database["public"]["Enums"]["quiz_workflow_status"] | null
          require_two_leader_eval: boolean | null
          reward_mode: string | null
          reward_tier_steps: number | null
          submitted_at: string | null
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
          approved_at?: string | null
          approved_by?: string | null
          campaign_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          evidence_required?: boolean | null
          id?: string
          owner_id?: string | null
          published_at?: string | null
          published_by?: string | null
          quiz_workflow_status?: Database["public"]["Enums"]["quiz_workflow_status"] | null
          require_two_leader_eval?: boolean | null
          reward_mode?: string | null
          reward_tier_steps?: number | null
          submitted_at?: string | null
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
          approved_at?: string | null
          approved_by?: string | null
          campaign_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          evidence_required?: boolean | null
          id?: string
          owner_id?: string | null
          published_at?: string | null
          published_by?: string | null
          quiz_workflow_status?: Database["public"]["Enums"]["quiz_workflow_status"] | null
          require_two_leader_eval?: boolean | null
          reward_mode?: string | null
          reward_tier_steps?: number | null
          submitted_at?: string | null
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
          {
            foreignKeyName: "challenges_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "team_campaign_performance"
            referencedColumns: ["campaign_id"]
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
            foreignKeyName: "evaluation_queue_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
          awaiting_second_evaluation: boolean | null
          challenge_id: string | null
          created_at: string | null
          eval_multiplier: number | null
          evidence_urls: string[] | null
          final_points: number | null
          first_evaluation_rating: number | null
          first_evaluator_id: string | null
          id: string
          parent_event_id: string | null
          payload: Json | null
          points_calculated: number | null
          quality_score: number | null
          retry_count: number
          second_evaluation_rating: number | null
          second_evaluator_id: string | null
          severity_weight: number | null
          status: Database["public"]["Enums"]["event_status"] | null
          team_modifier_applied: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          assigned_evaluator_id?: string | null
          assignment_type?: string | null
          awaiting_second_evaluation?: boolean | null
          challenge_id?: string | null
          created_at?: string | null
          eval_multiplier?: number | null
          evidence_urls?: string[] | null
          final_points?: number | null
          first_evaluation_rating?: number | null
          first_evaluator_id?: string | null
          id?: string
          parent_event_id?: string | null
          payload?: Json | null
          points_calculated?: number | null
          quality_score?: number | null
          retry_count?: number
          second_evaluation_rating?: number | null
          second_evaluator_id?: string | null
          severity_weight?: number | null
          status?: Database["public"]["Enums"]["event_status"] | null
          team_modifier_applied?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          assigned_evaluator_id?: string | null
          assignment_type?: string | null
          awaiting_second_evaluation?: boolean | null
          challenge_id?: string | null
          created_at?: string | null
          eval_multiplier?: number | null
          evidence_urls?: string[] | null
          final_points?: number | null
          first_evaluation_rating?: number | null
          first_evaluator_id?: string | null
          id?: string
          parent_event_id?: string | null
          payload?: Json | null
          points_calculated?: number | null
          quality_score?: number | null
          retry_count?: number
          second_evaluation_rating?: number | null
          second_evaluator_id?: string | null
          severity_weight?: number | null
          status?: Database["public"]["Enums"]["event_status"] | null
          team_modifier_applied?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_assigned_evaluator_id_fkey"
            columns: ["assigned_evaluator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "team_challenge_performance"
            referencedColumns: ["challenge_id"]
          },
          {
            foreignKeyName: "events_first_evaluator_id_fkey"
            columns: ["first_evaluator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_parent_event_id_fkey"
            columns: ["parent_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_second_evaluator_id_fkey"
            columns: ["second_evaluator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            foreignKeyName: "forum_topics_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "team_campaign_performance"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "forum_topics_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_topics_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "team_challenge_performance"
            referencedColumns: ["challenge_id"]
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
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_registrations: {
        Row: {
          created_at: string
          email: string
          id: string
          matricula: string | null
          name: string
          operational_base: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sigla_area: string
          status: string
          telefone: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          matricula?: string | null
          name: string
          operational_base: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sigla_area: string
          status?: string
          telefone?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          matricula?: string | null
          name?: string
          operational_base?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sigla_area?: string
          status?: string
          telefone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pending_registrations_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      password_reset_requests: {
        Row: {
          id: string
          identifier: string
          processed_at: string | null
          processed_by: string | null
          reason: string | null
          requested_at: string
          reviewer_notes: string | null
          status: string
          user_id: string
        }
        Insert: {
          id?: string
          identifier: string
          processed_at?: string | null
          processed_by?: string | null
          reason?: string | null
          requested_at?: string
          reviewer_notes?: string | null
          status?: string
          user_id: string
        }
        Update: {
          id?: string
          identifier?: string
          processed_at?: string | null
          processed_by?: string | null
          reason?: string | null
          requested_at?: string
          reviewer_notes?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "password_reset_requests_processed_by_fkey"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "password_reset_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_change_requests: {
        Row: {
          created_at: string | null
          field_name: string
          id: string
          new_value: string
          old_value: string | null
          requested_by: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          field_name: string
          id?: string
          new_value: string
          old_value?: string | null
          requested_by: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          field_name?: string
          id?: string
          new_value?: string
          old_value?: string | null
          requested_by?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_change_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_change_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_change_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_meta: Json | null
          avatar_thumbnail_url: string | null
          avatar_url: string | null
          coord_id: string | null
          created_at: string | null
          date_of_birth: string | null
          demotion_cooldown_until: string | null
          department_id: string | null
          division_id: string | null
          email: string | null
          id: string
          is_leader: boolean | null
          matricula: string | null
          mention_handle: string | null
          must_change_password: boolean | null
          name: string
          needs_profile_completion: boolean | null
          operational_base: string | null
          sigla_area: string | null
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
          date_of_birth?: string | null
          demotion_cooldown_until?: string | null
          department_id?: string | null
          division_id?: string | null
          email?: string | null
          id: string
          is_leader?: boolean | null
          matricula?: string | null
          mention_handle?: string | null
          must_change_password?: boolean | null
          name: string
          needs_profile_completion?: boolean | null
          operational_base?: string | null
          sigla_area?: string | null
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
          date_of_birth?: string | null
          demotion_cooldown_until?: string | null
          department_id?: string | null
          division_id?: string | null
          email?: string | null
          id?: string
          is_leader?: boolean | null
          matricula?: string | null
          mention_handle?: string | null
          must_change_password?: boolean | null
          name?: string
          needs_profile_completion?: boolean | null
          operational_base?: string | null
          sigla_area?: string | null
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
            referencedRelation: "team_campaign_performance"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_challenge_performance"
            referencedColumns: ["team_id"]
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
          {
            foreignKeyName: "quiz_questions_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "team_challenge_performance"
            referencedColumns: ["challenge_id"]
          },
          {
            foreignKeyName: "quiz_questions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_curation_comments: {
        Row: {
          author_id: string | null
          challenge_id: string
          created_at: string
          id: string
          kind: string
          message: string
        }
        Insert: {
          author_id?: string | null
          challenge_id: string
          created_at?: string
          id?: string
          kind?: string
          message: string
        }
        Update: {
          author_id?: string | null
          challenge_id?: string
          created_at?: string
          id?: string
          kind?: string
          message?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_curation_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_curation_comments_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_versions: {
        Row: {
          challenge_id: string
          created_at: string
          created_by: string | null
          id: string
          reason: string | null
          snapshot_json: Json
          version_number: number
        }
        Insert: {
          challenge_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
          snapshot_json: Json
          version_number: number
        }
        Update: {
          challenge_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
          snapshot_json?: Json
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "quiz_versions_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_imports: {
        Row: {
          ai_suggested: Json | null
          created_at: string
          created_by: string
          final_approved: Json | null
          id: string
          raw_extract: Json | null
          source_bucket: string
          source_mime: string | null
          source_path: string
          status: string
          updated_at: string
        }
        Insert: {
          ai_suggested?: Json | null
          created_at?: string
          created_by: string
          final_approved?: Json | null
          id?: string
          raw_extract?: Json | null
          source_bucket: string
          source_mime?: string | null
          source_path: string
          status?: string
          updated_at?: string
        }
        Update: {
          ai_suggested?: Json | null
          created_at?: string
          created_by?: string
          final_approved?: Json | null
          id?: string
          raw_extract?: Json | null
          source_bucket?: string
          source_mime?: string | null
          source_path?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_imports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          actor_id: string | null
          action: string
          after_json: Json | null
          before_json: Json | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
        }
        Insert: {
          actor_id?: string | null
          action: string
          after_json?: Json | null
          before_json?: Json | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
        }
        Update: {
          actor_id?: string | null
          action?: string
          after_json?: Json | null
          before_json?: Json | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
        Relationships: [
          {
            foreignKeyName: "safety_incidents_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_incidents_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_incidents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "team_campaign_performance"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "team_events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_challenge_performance"
            referencedColumns: ["team_id"]
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
            referencedRelation: "team_campaign_performance"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "team_performance_log_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_challenge_performance"
            referencedColumns: ["team_id"]
          },
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
          {
            foreignKeyName: "team_performance_log_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            foreignKeyName: "tier_demotion_log_demoted_by_fkey"
            columns: ["demoted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_demotion_log_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "safety_incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_demotion_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            foreignKeyName: "tier_progression_requests_coordinator_id_fkey"
            columns: ["coordinator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_progression_requests_special_challenge_id_fkey"
            columns: ["special_challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_progression_requests_special_challenge_id_fkey"
            columns: ["special_challenge_id"]
            isOneToOne: false
            referencedRelation: "team_challenge_performance"
            referencedColumns: ["challenge_id"]
          },
          {
            foreignKeyName: "tier_progression_requests_special_event_id_fkey"
            columns: ["special_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_progression_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          {
            foreignKeyName: "user_badges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_feedback_messages: {
        Row: {
          context_label: string | null
          context_type: string
          context_url: string | null
          created_at: string
          id: string
          message: string
          metadata: Json
          read_at: string | null
          recipient_id: string
          sender_id: string
        }
        Insert: {
          context_label?: string | null
          context_type?: string
          context_url?: string | null
          created_at?: string
          id?: string
          message: string
          metadata?: Json
          read_at?: string | null
          recipient_id: string
          sender_id: string
        }
        Update: {
          context_label?: string | null
          context_type?: string
          context_url?: string | null
          created_at?: string
          id?: string
          message?: string
          metadata?: Json
          read_at?: string | null
          recipient_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_feedback_messages_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_feedback_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            foreignKeyName: "user_quiz_answers_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "team_challenge_performance"
            referencedColumns: ["challenge_id"]
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
          {
            foreignKeyName: "user_quiz_answers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      team_campaign_performance: {
        Row: {
          adhesion_percentage: number | null
          campaign_id: string | null
          campaign_title: string | null
          completed_count: number | null
          completion_percentage: number | null
          participants_count: number | null
          team_id: string | null
          team_name: string | null
          total_members: number | null
        }
        Relationships: []
      }
      team_challenge_performance: {
        Row: {
          adhesion_percentage: number | null
          avg_xp_earned: number | null
          challenge_id: string | null
          challenge_title: string | null
          challenge_type: Database["public"]["Enums"]["challenge_type"] | null
          completed_count: number | null
          completion_percentage: number | null
          participants_count: number | null
          team_id: string | null
          team_name: string | null
          total_members: number | null
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
      increment_user_xp: {
        Args: { _user_id: string; _xp_to_add: number }
        Returns: undefined
      }
      refresh_team_performance: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role:
        | "colaborador"
        | "coordenador_djtx"
        | "gerente_divisao_djtx"
        | "gerente_djt"
        | "admin"
        | "content_curator"
        | "invited"
      challenge_type: "quiz" | "mentoria" | "atitude" | "inspecao" | "forum"
      quiz_workflow_status:
        | "DRAFT"
        | "SUBMITTED"
        | "APPROVED"
        | "REJECTED"
        | "PUBLISHED"
      event_status:
        | "submitted"
        | "awaiting_evaluation"
        | "evaluated"
        | "rejected"
        | "retry_pending"
        | "retry_in_progress"
        | "awaiting_second_evaluation"
        | "approved"
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
        "admin",
        "content_curator",
        "invited",
      ],
      challenge_type: ["quiz", "mentoria", "atitude", "inspecao", "forum"],
      quiz_workflow_status: ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "PUBLISHED"],
      event_status: [
        "submitted",
        "awaiting_evaluation",
        "evaluated",
        "rejected",
        "retry_pending",
        "retry_in_progress",
        "awaiting_second_evaluation",
        "approved",
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
