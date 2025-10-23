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
          payload: Json | null
          points_calculated: number | null
          quality_score: number | null
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
          payload?: Json | null
          points_calculated?: number | null
          quality_score?: number | null
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
          payload?: Json | null
          points_calculated?: number | null
          quality_score?: number | null
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
        ]
      }
      profiles: {
        Row: {
          avatar_meta: Json | null
          created_at: string | null
          email: string | null
          id: string
          level: number | null
          name: string
          team_id: string | null
          updated_at: string | null
          xp: number | null
        }
        Insert: {
          avatar_meta?: Json | null
          created_at?: string | null
          email?: string | null
          id: string
          level?: number | null
          name: string
          team_id?: string | null
          updated_at?: string | null
          xp?: number | null
        }
        Update: {
          avatar_meta?: Json | null
          created_at?: string | null
          email?: string | null
          id?: string
          level?: number | null
          name?: string
          team_id?: string | null
          updated_at?: string | null
          xp?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_team_id_fkey"
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
      [_ in never]: never
    }
    Functions: {
      calculate_final_points: {
        Args: {
          _base_xp: number
          _eval_multiplier: number
          _quality_score: number
          _team_modifier: number
        }
        Returns: number
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
        | "admin"
        | "gerente"
        | "lider_divisao"
        | "coordenador"
        | "colaborador"
      challenge_type: "quiz" | "mentoria" | "atitude" | "inspecao" | "forum"
      event_status:
        | "submitted"
        | "awaiting_evaluation"
        | "evaluated"
        | "rejected"
      reviewer_level: "divisao" | "coordenacao"
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
        "admin",
        "gerente",
        "lider_divisao",
        "coordenador",
        "colaborador",
      ],
      challenge_type: ["quiz", "mentoria", "atitude", "inspecao", "forum"],
      event_status: [
        "submitted",
        "awaiting_evaluation",
        "evaluated",
        "rejected",
      ],
      reviewer_level: ["divisao", "coordenacao"],
    },
  },
} as const
