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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ad_sets: {
        Row: {
          ad_seconds: number
          created_at: string
          id: string
          name: string
          ref_id: string | null
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ad_seconds?: number
          created_at?: string
          id?: string
          name?: string
          ref_id?: string | null
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ad_seconds?: number
          created_at?: string
          id?: string
          name?: string
          ref_id?: string | null
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_sets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ads: {
        Row: {
          ad_set_id: string
          content_type: string
          created_at: string
          id: string
          name: string
          path: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ad_set_id: string
          content_type?: string
          created_at?: string
          id?: string
          name?: string
          path: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ad_set_id?: string
          content_type?: string
          created_at?: string
          id?: string
          name?: string
          path?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_ad_set_id_fkey"
            columns: ["ad_set_id"]
            isOneToOne: false
            referencedRelation: "ad_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      color_schemes: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          ref_id: string | null
          tenant_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          ref_id?: string | null
          tenant_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          ref_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "color_schemes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_config: {
        Row: {
          api_key: string
          endpoint_url: string
          id: boolean
          updated_at: string
        }
        Insert: {
          api_key: string
          endpoint_url: string
          id?: boolean
          updated_at?: string
        }
        Update: {
          api_key?: string
          endpoint_url?: string
          id?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      entries: {
        Row: {
          background_align: string
          background_content_type: string | null
          background_height: number
          background_margin: number
          background_opacity: number
          background_path: string | null
          background_tint: string | null
          color_scheme_id: string | null
          created_at: string
          description: string
          end_time: string | null
          id: string
          kind: string
          notified_at: string | null
          notified_teams: string[]
          notify: boolean
          tags: string[]
          tenant_id: string
          time: string
          title: string
          updated_at: string
        }
        Insert: {
          background_align?: string
          background_content_type?: string | null
          background_height?: number
          background_margin?: number
          background_opacity?: number
          background_path?: string | null
          background_tint?: string | null
          color_scheme_id?: string | null
          created_at?: string
          description: string
          end_time?: string | null
          id?: string
          kind?: string
          notified_at?: string | null
          notified_teams?: string[]
          notify?: boolean
          tags?: string[]
          tenant_id: string
          time: string
          title?: string
          updated_at?: string
        }
        Update: {
          background_align?: string
          background_content_type?: string | null
          background_height?: number
          background_margin?: number
          background_opacity?: number
          background_path?: string | null
          background_tint?: string | null
          color_scheme_id?: string | null
          created_at?: string
          description?: string
          end_time?: string | null
          id?: string
          kind?: string
          notified_at?: string | null
          notified_teams?: string[]
          notify?: boolean
          tags?: string[]
          tenant_id?: string
          time?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "entries_color_scheme_id_fkey"
            columns: ["color_scheme_id"]
            isOneToOne: false
            referencedRelation: "color_schemes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          color_scheme_id: string | null
          created_at: string
          id: string
          name: string
          ref_id: string | null
          template: string | null
          tenant_id: string
        }
        Insert: {
          color_scheme_id?: string | null
          created_at?: string
          id?: string
          name: string
          ref_id?: string | null
          template?: string | null
          tenant_id: string
        }
        Update: {
          color_scheme_id?: string | null
          created_at?: string
          id?: string
          name?: string
          ref_id?: string | null
          template?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_color_scheme_id_fkey"
            columns: ["color_scheme_id"]
            isOneToOne: false
            referencedRelation: "color_schemes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          id: string
          members: string
          name: string
          project: string
          ref_id: string | null
          room_id: string | null
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          members?: string
          name: string
          project?: string
          ref_id?: string | null
          room_id?: string | null
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          members?: string
          name?: string
          project?: string
          ref_id?: string | null
          room_id?: string | null
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          accent_color: string
          ad_seconds: number
          created_at: string
          focus_count: number
          focus_dim_opacity: number
          focus_minutes: number
          focus_mode: string
          id: string
          key: string
          logo_height: number
          logo_url: string | null
          name: string
          past_grace_minutes: number
          pin_hash: string | null
          practice_minutes: number
          practice_room_scope: string
          template: string
        }
        Insert: {
          accent_color?: string
          ad_seconds?: number
          created_at?: string
          focus_count?: number
          focus_dim_opacity?: number
          focus_minutes?: number
          focus_mode?: string
          id?: string
          key: string
          logo_height?: number
          logo_url?: string | null
          name?: string
          past_grace_minutes?: number
          pin_hash?: string | null
          practice_minutes?: number
          practice_room_scope?: string
          template?: string
        }
        Update: {
          accent_color?: string
          ad_seconds?: number
          created_at?: string
          focus_count?: number
          focus_dim_opacity?: number
          focus_minutes?: number
          focus_mode?: string
          id?: string
          key?: string
          logo_height?: number
          logo_url?: string | null
          name?: string
          past_grace_minutes?: number
          pin_hash?: string | null
          practice_minutes?: number
          practice_room_scope?: string
          template?: string
        }
        Relationships: []
      }
      webhooks: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          name: string
          ref_id: string | null
          tenant_id: string
          type: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          ref_id?: string | null
          tenant_id: string
          type?: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          ref_id?: string | null
          tenant_id?: string
          type?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      next_webhook_dispatch_at: { Args: never; Returns: string }
      reschedule_webhook_dispatch: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
