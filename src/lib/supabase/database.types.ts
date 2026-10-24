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
    PostgrestVersion: "14.18"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agent_configs: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["agent_kind"]
          model: string
          organization_id: string
          prompt: string
          settings: Json
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["agent_kind"]
          model: string
          organization_id: string
          prompt: string
          settings?: Json
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["agent_kind"]
          model?: string
          organization_id?: string
          prompt?: string
          settings?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          created_at: string
          id: string
          is_enabled: boolean
          kind: Database["public"]["Enums"]["agent_kind"]
          name: string
          organization_id: string
          status: string
          tagline: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          kind: Database["public"]["Enums"]["agent_kind"]
          name: string
          organization_id: string
          status?: string
          tagline?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          kind?: Database["public"]["Enums"]["agent_kind"]
          name?: string
          organization_id?: string
          status?: string
          tagline?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_calls: {
        Row: {
          agent_config_id: string | null
          agent_kind: Database["public"]["Enums"]["agent_kind"]
          cache_read_tokens: number | null
          cache_write_tokens: number | null
          case_id: string | null
          conversation_id: string | null
          cost_usd: number | null
          created_at: string
          decision: Json | null
          error: string | null
          id: string
          input_tokens: number | null
          latency_ms: number | null
          message_id: string | null
          model: string
          organization_id: string
          output_tokens: number | null
          provider: string
          request_id: string | null
          stop_reason: string | null
          trace: Json | null
        }
        Insert: {
          agent_config_id?: string | null
          agent_kind: Database["public"]["Enums"]["agent_kind"]
          cache_read_tokens?: number | null
          cache_write_tokens?: number | null
          case_id?: string | null
          conversation_id?: string | null
          cost_usd?: number | null
          created_at?: string
          decision?: Json | null
          error?: string | null
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          message_id?: string | null
          model: string
          organization_id: string
          output_tokens?: number | null
          provider?: string
          request_id?: string | null
          stop_reason?: string | null
          trace?: Json | null
        }
        Update: {
          agent_config_id?: string | null
          agent_kind?: Database["public"]["Enums"]["agent_kind"]
          cache_read_tokens?: number | null
          cache_write_tokens?: number | null
          case_id?: string | null
          conversation_id?: string | null
          cost_usd?: number | null
          created_at?: string
          decision?: Json | null
          error?: string | null
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          message_id?: string | null
          model?: string
          organization_id?: string
          output_tokens?: number | null
          provider?: string
          request_id?: string | null
          stop_reason?: string | null
          trace?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_calls_agent_config_id_fkey"
            columns: ["agent_config_id"]
            isOneToOne: false
            referencedRelation: "agent_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_calls_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_calls_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_calls_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_calls_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_calls_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_tool_calls: {
        Row: {
          ai_call_id: string
          created_at: string
          duration_ms: number | null
          id: string
          input: Json | null
          is_error: boolean
          organization_id: string
          output: Json | null
          tool_name: string
        }
        Insert: {
          ai_call_id: string
          created_at?: string
          duration_ms?: number | null
          id?: string
          input?: Json | null
          is_error?: boolean
          organization_id: string
          output?: Json | null
          tool_name: string
        }
        Update: {
          ai_call_id?: string
          created_at?: string
          duration_ms?: number | null
          id?: string
          input?: Json | null
          is_error?: boolean
          organization_id?: string
          output?: Json | null
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_tool_calls_ai_call_id_fkey"
            columns: ["ai_call_id"]
            isOneToOne: false
            referencedRelation: "ai_calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_tool_calls_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      area_queries: {
        Row: {
          answer: string | null
          answered_at: string | null
          answered_by: string | null
          case_id: string
          conversation_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          organization_id: string
          question: string
          reply_sent_at: string | null
          sector_id: string
          status: Database["public"]["Enums"]["area_query_status"]
          updated_at: string
        }
        Insert: {
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          case_id: string
          conversation_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          organization_id: string
          question: string
          reply_sent_at?: string | null
          sector_id: string
          status?: Database["public"]["Enums"]["area_query_status"]
          updated_at?: string
        }
        Update: {
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          case_id?: string
          conversation_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          organization_id?: string
          question?: string
          reply_sent_at?: string | null
          sector_id?: string
          status?: Database["public"]["Enums"]["area_query_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "area_queries_answered_by_fkey"
            columns: ["answered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_queries_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_queries_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_queries_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_queries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_queries_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_profile_id: string | null
          created_at: string
          data: Json
          entity_id: string | null
          entity_type: string
          id: string
          organization_id: string
        }
        Insert: {
          action: string
          actor_profile_id?: string | null
          created_at?: string
          data?: Json
          entity_id?: string | null
          entity_type: string
          id?: string
          organization_id: string
        }
        Update: {
          action?: string
          actor_profile_id?: string | null
          created_at?: string
          data?: Json
          entity_id?: string | null
          entity_type?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_recipients: {
        Row: {
          broadcast_id: string
          contact_id: string
          error: string | null
          message_id: string | null
          organization_id: string
          status: Database["public"]["Enums"]["message_status"]
        }
        Insert: {
          broadcast_id: string
          contact_id: string
          error?: string | null
          message_id?: string | null
          organization_id: string
          status?: Database["public"]["Enums"]["message_status"]
        }
        Update: {
          broadcast_id?: string
          contact_id?: string
          error?: string | null
          message_id?: string | null
          organization_id?: string
          status?: Database["public"]["Enums"]["message_status"]
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_recipients_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_recipients_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_recipients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcasts: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          scheduled_at: string | null
          segment: Json
          status: Database["public"]["Enums"]["broadcast_status"]
          template_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
          scheduled_at?: string | null
          segment?: Json
          status?: Database["public"]["Enums"]["broadcast_status"]
          template_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          scheduled_at?: string | null
          segment?: Json
          status?: Database["public"]["Enums"]["broadcast_status"]
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcasts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcasts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcasts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      business_units: {
        Row: {
          created_at: string
          default_sector_id: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_sector_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_sector_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_units_default_sector_id_fkey"
            columns: ["default_sector_id"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_units_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      case_events: {
        Row: {
          actor_profile_id: string | null
          actor_type: Database["public"]["Enums"]["message_sender"]
          case_id: string
          created_at: string
          data: Json
          event_type: string
          id: string
          organization_id: string
        }
        Insert: {
          actor_profile_id?: string | null
          actor_type: Database["public"]["Enums"]["message_sender"]
          case_id: string
          created_at?: string
          data?: Json
          event_type: string
          id?: string
          organization_id: string
        }
        Update: {
          actor_profile_id?: string | null
          actor_type?: Database["public"]["Enums"]["message_sender"]
          case_id?: string
          created_at?: string
          data?: Json
          event_type?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      case_tags: {
        Row: {
          case_id: string
          created_at: string
          organization_id: string
          tag_id: string
        }
        Insert: {
          case_id: string
          created_at?: string
          organization_id: string
          tag_id: string
        }
        Update: {
          case_id?: string
          created_at?: string
          organization_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_tags_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          assigned_to: string | null
          collected_data: Json
          contact_id: string
          conversation_id: string | null
          created_at: string
          id: string
          opened_at: string
          organization_id: string
          priority: Database["public"]["Enums"]["case_priority"]
          resolution: string | null
          resolved_at: string | null
          sector_id: string | null
          status: Database["public"]["Enums"]["case_status"]
          summary: string | null
          title: string | null
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          collected_data?: Json
          contact_id: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          opened_at?: string
          organization_id: string
          priority?: Database["public"]["Enums"]["case_priority"]
          resolution?: string | null
          resolved_at?: string | null
          sector_id?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          summary?: string | null
          title?: string | null
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          collected_data?: Json
          contact_id?: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          opened_at?: string
          organization_id?: string
          priority?: Database["public"]["Enums"]["case_priority"]
          resolution?: string | null
          resolved_at?: string | null
          sector_id?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          summary?: string | null
          title?: string | null
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cases_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "business_units"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          config: Json
          created_at: string
          external_id: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          secret_ref: string | null
          type: Database["public"]["Enums"]["channel_type"]
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          external_id: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          secret_ref?: string | null
          type: Database["public"]["Enums"]["channel_type"]
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          external_id?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          secret_ref?: string | null
          type?: Database["public"]["Enums"]["channel_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_identities: {
        Row: {
          channel_type: Database["public"]["Enums"]["channel_type"]
          contact_id: string
          created_at: string
          id: string
          identifier: string
          organization_id: string
        }
        Insert: {
          channel_type: Database["public"]["Enums"]["channel_type"]
          contact_id: string
          created_at?: string
          id?: string
          identifier: string
          organization_id: string
        }
        Update: {
          channel_type?: Database["public"]["Enums"]["channel_type"]
          contact_id?: string
          created_at?: string
          id?: string
          identifier?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_identities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_identities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          client_record_id: string | null
          created_at: string
          display_name: string | null
          document_number: string | null
          id: string
          locality: string | null
          notes: string | null
          opted_in_at: string | null
          opted_out_at: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          client_record_id?: string | null
          created_at?: string
          display_name?: string | null
          document_number?: string | null
          id?: string
          locality?: string | null
          notes?: string | null
          opted_in_at?: string | null
          opted_out_at?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          client_record_id?: string | null
          created_at?: string
          display_name?: string | null
          document_number?: string | null
          id?: string
          locality?: string | null
          notes?: string | null
          opted_in_at?: string | null
          opted_out_at?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_evaluations: {
        Row: {
          ai_call_id: string | null
          case_id: string | null
          conversation_id: string | null
          created_at: string
          evaluator: string
          id: string
          notes: string | null
          organization_id: string
          resolved_effectively: boolean | null
          rubric_version: string
          rules_compliance_score: number | null
          scores: Json
        }
        Insert: {
          ai_call_id?: string | null
          case_id?: string | null
          conversation_id?: string | null
          created_at?: string
          evaluator: string
          id?: string
          notes?: string | null
          organization_id: string
          resolved_effectively?: boolean | null
          rubric_version: string
          rules_compliance_score?: number | null
          scores?: Json
        }
        Update: {
          ai_call_id?: string | null
          case_id?: string | null
          conversation_id?: string | null
          created_at?: string
          evaluator?: string
          id?: string
          notes?: string | null
          organization_id?: string
          resolved_effectively?: boolean | null
          rubric_version?: string
          rules_compliance_score?: number | null
          scores?: Json
        }
        Relationships: [
          {
            foreignKeyName: "conversation_evaluations_ai_call_id_fkey"
            columns: ["ai_call_id"]
            isOneToOne: false
            referencedRelation: "ai_calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_evaluations_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_evaluations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_evaluations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_evaluations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_windows: {
        Row: {
          contact_id: string
          conversation_id: string | null
          created_at: string
          credits: number
          expires_at: string
          id: string
          initiated_by: string
          opened_at: string
          organization_id: string
        }
        Insert: {
          contact_id: string
          conversation_id?: string | null
          created_at?: string
          credits?: number
          expires_at: string
          id?: string
          initiated_by: string
          opened_at?: string
          organization_id: string
        }
        Update: {
          contact_id?: string
          conversation_id?: string | null
          created_at?: string
          credits?: number
          expires_at?: string
          id?: string
          initiated_by?: string
          opened_at?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_windows_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_windows_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_windows_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_windows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          ai_enabled: boolean
          assigned_to: string | null
          channel_id: string
          contact_id: string
          created_at: string
          id: string
          last_inbound_at: string | null
          last_message_at: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          ai_enabled?: boolean
          assigned_to?: string | null
          channel_id: string
          contact_id: string
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          ai_enabled?: boolean
          assigned_to?: string | null
          channel_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      followups: {
        Row: {
          case_id: string
          contact_id: string
          conversation_id: string | null
          created_at: string
          due_at: string
          id: string
          message_id: string | null
          organization_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["followup_status"]
          step_hours: number
        }
        Insert: {
          case_id: string
          contact_id: string
          conversation_id?: string | null
          created_at?: string
          due_at: string
          id?: string
          message_id?: string | null
          organization_id: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["followup_status"]
          step_hours: number
        }
        Update: {
          case_id?: string
          contact_id?: string
          conversation_id?: string | null
          created_at?: string
          due_at?: string
          id?: string
          message_id?: string | null
          organization_id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["followup_status"]
          step_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "followups_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followups_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followups_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followups_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followups_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_notes: {
        Row: {
          author_id: string | null
          body: string
          case_id: string | null
          conversation_id: string | null
          created_at: string
          id: string
          organization_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          case_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          case_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_notes_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_notes_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_notes_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      media_files: {
        Row: {
          created_at: string
          id: string
          message_id: string
          mime_type: string
          organization_id: string
          provider_media_id: string | null
          sha256: string | null
          size_bytes: number | null
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          mime_type: string
          organization_id: string
          provider_media_id?: string | null
          sha256?: string | null
          size_bytes?: number | null
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          mime_type?: string
          organization_id?: string
          provider_media_id?: string | null
          sha256?: string | null
          size_bytes?: number | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_files_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_files_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          body: string
          category: string | null
          channel_id: string | null
          created_at: string
          id: string
          language: string
          meta_status: Database["public"]["Enums"]["template_meta_status"]
          meta_template_id: string | null
          name: string
          organization_id: string
          updated_at: string
          variables: Json
        }
        Insert: {
          body: string
          category?: string | null
          channel_id?: string | null
          created_at?: string
          id?: string
          language?: string
          meta_status?: Database["public"]["Enums"]["template_meta_status"]
          meta_template_id?: string | null
          name: string
          organization_id: string
          updated_at?: string
          variables?: Json
        }
        Update: {
          body?: string
          category?: string | null
          channel_id?: string | null
          created_at?: string
          id?: string
          language?: string
          meta_status?: Database["public"]["Enums"]["template_meta_status"]
          meta_template_id?: string | null
          name?: string
          organization_id?: string
          updated_at?: string
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string | null
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["message_direction"]
          error: Json | null
          external_id: string | null
          id: string
          organization_id: string
          pricing: Json | null
          provider_timestamp: string | null
          raw: Json | null
          sender: Database["public"]["Enums"]["message_sender"]
          sender_profile_id: string | null
          status: Database["public"]["Enums"]["message_status"]
          status_updated_at: string | null
          template_name: string | null
          transcription: string | null
          transcription_provider: string | null
          type: Database["public"]["Enums"]["message_type"]
        }
        Insert: {
          body?: string | null
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["message_direction"]
          error?: Json | null
          external_id?: string | null
          id?: string
          organization_id: string
          pricing?: Json | null
          provider_timestamp?: string | null
          raw?: Json | null
          sender: Database["public"]["Enums"]["message_sender"]
          sender_profile_id?: string | null
          status?: Database["public"]["Enums"]["message_status"]
          status_updated_at?: string | null
          template_name?: string | null
          transcription?: string | null
          transcription_provider?: string | null
          type?: Database["public"]["Enums"]["message_type"]
        }
        Update: {
          body?: string | null
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          error?: Json | null
          external_id?: string | null
          id?: string
          organization_id?: string
          pricing?: Json | null
          provider_timestamp?: string | null
          raw?: Json | null
          sender?: Database["public"]["Enums"]["message_sender"]
          sender_profile_id?: string | null
          status?: Database["public"]["Enums"]["message_status"]
          status_updated_at?: string | null
          template_name?: string | null
          transcription?: string | null
          transcription_provider?: string | null
          type?: Database["public"]["Enums"]["message_type"]
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_profile_id_fkey"
            columns: ["sender_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          case_id: string | null
          created_at: string
          id: string
          organization_id: string
          profile_id: string
          read_at: string | null
          title: string
          type: string
        }
        Insert: {
          body?: string | null
          case_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
          profile_id: string
          read_at?: string | null
          title: string
          type: string
        }
        Update: {
          body?: string | null
          case_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          profile_id?: string
          read_at?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          settings: Json
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          settings?: Json
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          settings?: Json
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          is_active?: boolean
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sector_members: {
        Row: {
          created_at: string
          is_lead: boolean
          organization_id: string
          profile_id: string
          sector_id: string
        }
        Insert: {
          created_at?: string
          is_lead?: boolean
          organization_id: string
          profile_id: string
          sector_id: string
        }
        Update: {
          created_at?: string
          is_lead?: boolean
          organization_id?: string
          profile_id?: string
          sector_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sector_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sector_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sector_members_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["id"]
          },
        ]
      }
      sectors: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sectors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string | null
          created_at: string
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          attempts: number
          channel_type: Database["public"]["Enums"]["channel_type"]
          claimed_at: string | null
          dedupe_key: string
          error: string | null
          id: string
          organization_id: string | null
          payload: Json
          processed_at: string | null
          received_at: string
        }
        Insert: {
          attempts?: number
          channel_type: Database["public"]["Enums"]["channel_type"]
          claimed_at?: string | null
          dedupe_key: string
          error?: string | null
          id?: string
          organization_id?: string | null
          payload: Json
          processed_at?: string | null
          received_at?: string
        }
        Update: {
          attempts?: number
          channel_type?: Database["public"]["Enums"]["channel_type"]
          claimed_at?: string | null
          dedupe_key?: string
          error?: string | null
          id?: string
          organization_id?: string | null
          payload?: Json
          processed_at?: string | null
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      conversation_summaries: {
        Row: {
          ai_enabled: boolean | null
          assigned_to: string | null
          case_assigned_to: string | null
          case_priority: Database["public"]["Enums"]["case_priority"] | null
          case_status: Database["public"]["Enums"]["case_status"] | null
          channel_id: string | null
          channel_name: string | null
          channel_type: Database["public"]["Enums"]["channel_type"] | null
          contact_id: string | null
          contact_name: string | null
          id: string | null
          last_body: string | null
          last_direction:
            | Database["public"]["Enums"]["message_direction"]
            | null
          last_inbound_at: string | null
          last_message_at: string | null
          last_type: Database["public"]["Enums"]["message_type"] | null
          organization_id: string | null
          window_open: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "cases_assigned_to_fkey"
            columns: ["case_assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      agent_ask_area: {
        Args: {
          p_conversation_id: string
          p_question: string
          p_sector_slug: string
        }
        Returns: string
      }
      agent_handoff_case: {
        Args: {
          p_conversation_id: string
          p_priority?: Database["public"]["Enums"]["case_priority"]
          p_sector_slug: string
          p_summary: string
        }
        Returns: string
      }
      agent_save_case_data: {
        Args: {
          p_conversation_id: string
          p_data: Json
          p_title: string
          p_unit_slug: string
        }
        Returns: string
      }
      claim_webhook_events: {
        Args: { p_limit?: number; p_prefix: string }
        Returns: {
          attempts: number
          channel_type: Database["public"]["Enums"]["channel_type"]
          claimed_at: string | null
          dedupe_key: string
          error: string | null
          id: string
          organization_id: string | null
          payload: Json
          processed_at: string | null
          received_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "webhook_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      finalize_outbound_message: {
        Args: {
          p_external_id: string
          p_message_id: string
          p_provider_timestamp: string
        }
        Returns: undefined
      }
      ingest_inbound_message: {
        Args: {
          p_body: string
          p_channel_id: string
          p_channel_type: Database["public"]["Enums"]["channel_type"]
          p_contact_name: string
          p_external_id: string
          p_identifier: string
          p_organization_id: string
          p_provider_timestamp: string
          p_raw: Json
          p_type: Database["public"]["Enums"]["message_type"]
        }
        Returns: string
      }
    }
    Enums: {
      agent_kind:
        | "attention"
        | "copilot"
        | "summarizer"
        | "classifier"
        | "analytic"
        | "evaluator"
      app_role: "superadmin" | "operator" | "viewer"
      area_query_status: "pending" | "answered" | "cancelled" | "expired"
      broadcast_status: "draft" | "scheduled" | "sending" | "done" | "cancelled"
      case_priority: "low" | "normal" | "high" | "urgent"
      case_status:
        | "new"
        | "in_progress"
        | "waiting_contact"
        | "waiting_area"
        | "resolved"
      channel_type:
        | "whatsapp"
        | "instagram"
        | "messenger"
        | "email"
        | "telegram"
      followup_status: "pending" | "sent" | "cancelled" | "skipped"
      message_direction: "inbound" | "outbound"
      message_sender: "contact" | "agent" | "operator" | "system"
      message_status: "queued" | "sent" | "delivered" | "read" | "failed"
      message_type:
        | "text"
        | "audio"
        | "image"
        | "document"
        | "video"
        | "sticker"
        | "location"
        | "template"
        | "interactive"
        | "reaction"
        | "unsupported"
      template_meta_status:
        | "draft"
        | "submitted"
        | "approved"
        | "rejected"
        | "paused"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      agent_kind: [
        "attention",
        "copilot",
        "summarizer",
        "classifier",
        "analytic",
        "evaluator",
      ],
      app_role: ["superadmin", "operator", "viewer"],
      area_query_status: ["pending", "answered", "cancelled", "expired"],
      broadcast_status: ["draft", "scheduled", "sending", "done", "cancelled"],
      case_priority: ["low", "normal", "high", "urgent"],
      case_status: [
        "new",
        "in_progress",
        "waiting_contact",
        "waiting_area",
        "resolved",
      ],
      channel_type: ["whatsapp", "instagram", "messenger", "email", "telegram"],
      followup_status: ["pending", "sent", "cancelled", "skipped"],
      message_direction: ["inbound", "outbound"],
      message_sender: ["contact", "agent", "operator", "system"],
      message_status: ["queued", "sent", "delivered", "read", "failed"],
      message_type: [
        "text",
        "audio",
        "image",
        "document",
        "video",
        "sticker",
        "location",
        "template",
        "interactive",
        "reaction",
        "unsupported",
      ],
      template_meta_status: [
        "draft",
        "submitted",
        "approved",
        "rejected",
        "paused",
      ],
    },
  },
} as const
