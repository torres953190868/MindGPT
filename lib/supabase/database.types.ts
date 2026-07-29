import type { BranchType, BugReportStatus, ChatRole, LlmRouteTask } from "@/lib/types";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      branchmind_projects: {
        Row: {
          id: string;
          owner_session_id: string;
          title: string;
          notes: string;
          root_node_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          owner_session_id: string;
          title: string;
          notes?: string;
          root_node_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_session_id?: string;
          title?: string;
          notes?: string;
          root_node_id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      branchmind_nodes: {
        Row: {
          id: string;
          project_id: string;
          parent_id: string | null;
          title: string;
          title_manually_edited: boolean;
          summary: string;
          position_x: number;
          position_y: number;
          branch_type: BranchType;
          collapsed: boolean;
          child_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          project_id: string;
          parent_id?: string | null;
          title: string;
          title_manually_edited?: boolean;
          summary?: string;
          position_x?: number;
          position_y?: number;
          branch_type: BranchType;
          collapsed?: boolean;
          child_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          parent_id?: string | null;
          title?: string;
          title_manually_edited?: boolean;
          summary?: string;
          position_x?: number;
          position_y?: number;
          branch_type?: BranchType;
          collapsed?: boolean;
          child_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "branchmind_nodes_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "branchmind_projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "branchmind_nodes_parent_fkey";
            columns: ["project_id", "parent_id"];
            referencedRelation: "branchmind_nodes";
            referencedColumns: ["project_id", "id"];
          },
        ];
      };
      branchmind_messages: {
        Row: {
          id: string;
          project_id: string;
          node_id: string;
          role: ChatRole;
          content: string;
          attachments: Json;
          citations: Json;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id: string;
          project_id: string;
          node_id: string;
          role: ChatRole;
          content: string;
          attachments?: Json;
          citations?: Json;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          node_id?: string;
          role?: ChatRole;
          content?: string;
          attachments?: Json;
          citations?: Json;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "branchmind_messages_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "branchmind_projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "branchmind_messages_node_fkey";
            columns: ["project_id", "node_id"];
            referencedRelation: "branchmind_nodes";
            referencedColumns: ["project_id", "id"];
          },
        ];
      };
      documents: {
        Row: {
          id: string;
          user_id: string | null;
          file_name: string;
          file_url: string | null;
          storage_path: string | null;
          mime_type: string;
          content_hash: string | null;
          page_count: number;
          title: string | null;
          status:
            | "queued"
            | "uploaded"
            | "parsing"
            | "parsed"
            | "indexing"
            | "indexed"
            | "failed";
          parser_version: string;
          chunk_version: string;
          error_message: string | null;
          error_code: string | null;
          error_stage: string | null;
          error_request_id: string | null;
          error_details: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          user_id?: string | null;
          file_name: string;
          file_url?: string | null;
          storage_path?: string | null;
          mime_type: string;
          content_hash?: string | null;
          page_count?: number;
          title?: string | null;
          status?:
            | "queued"
            | "uploaded"
            | "parsing"
            | "parsed"
            | "indexing"
            | "indexed"
            | "failed";
          parser_version: string;
          chunk_version: string;
          error_message?: string | null;
          error_code?: string | null;
          error_stage?: string | null;
          error_request_id?: string | null;
          error_details?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          file_name?: string;
          file_url?: string | null;
          storage_path?: string | null;
          mime_type?: string;
          content_hash?: string | null;
          page_count?: number;
          title?: string | null;
          status?:
            | "queued"
            | "uploaded"
            | "parsing"
            | "parsed"
            | "indexing"
            | "indexed"
            | "failed";
          parser_version?: string;
          chunk_version?: string;
          error_message?: string | null;
          error_code?: string | null;
          error_stage?: string | null;
          error_request_id?: string | null;
          error_details?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      document_pages: {
        Row: {
          id: string;
          document_id: string;
          page_number: number;
          raw_text: string;
          clean_text: string;
          char_count: number;
          token_count: number;
          created_at: string;
        };
        Insert: {
          id: string;
          document_id: string;
          page_number: number;
          raw_text: string;
          clean_text: string;
          char_count?: number;
          token_count?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          document_id?: string;
          page_number?: number;
          raw_text?: string;
          clean_text?: string;
          char_count?: number;
          token_count?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_pages_document_id_fkey";
            columns: ["document_id"];
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      document_sections: {
        Row: {
          id: string;
          document_id: string;
          title: string;
          heading_path: Json;
          level: number;
          page_start: number;
          page_end: number;
          source: "pdf_outline" | "font_heuristic" | "regex" | "fallback";
          created_at: string;
        };
        Insert: {
          id: string;
          document_id: string;
          title: string;
          heading_path?: Json;
          level: number;
          page_start: number;
          page_end: number;
          source: "pdf_outline" | "font_heuristic" | "regex" | "fallback";
          created_at?: string;
        };
        Update: {
          id?: string;
          document_id?: string;
          title?: string;
          heading_path?: Json;
          level?: number;
          page_start?: number;
          page_end?: number;
          source?: "pdf_outline" | "font_heuristic" | "regex" | "fallback";
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_sections_document_id_fkey";
            columns: ["document_id"];
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      document_chunks: {
        Row: {
          id: string;
          document_id: string;
          section_id: string | null;
          parent_chunk_id: string | null;
          chunk_index: number;
          content: string;
          content_hash: string;
          page_start: number;
          page_end: number;
          heading_path: Json;
          token_count: number;
          char_start: number | null;
          char_end: number | null;
          embedding: number[] | string | null;
          embedding_model: string | null;
          chunk_version: string;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id: string;
          document_id: string;
          section_id?: string | null;
          parent_chunk_id?: string | null;
          chunk_index: number;
          content: string;
          content_hash: string;
          page_start: number;
          page_end: number;
          heading_path?: Json;
          token_count: number;
          char_start?: number | null;
          char_end?: number | null;
          embedding?: number[] | null;
          embedding_model?: string | null;
          chunk_version: string;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          document_id?: string;
          section_id?: string | null;
          parent_chunk_id?: string | null;
          chunk_index?: number;
          content?: string;
          content_hash?: string;
          page_start?: number;
          page_end?: number;
          heading_path?: Json;
          token_count?: number;
          char_start?: number | null;
          char_end?: number | null;
          embedding?: number[] | null;
          embedding_model?: string | null;
          chunk_version?: string;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey";
            columns: ["document_id"];
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_chunks_section_id_fkey";
            columns: ["section_id"];
            referencedRelation: "document_sections";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_chunks_parent_chunk_id_fkey";
            columns: ["parent_chunk_id"];
            referencedRelation: "document_chunks";
            referencedColumns: ["id"];
          },
        ];
      };
      branchmind_user_plans: {
        Row: {
          user_id: string;
          plan: string;
          display_name: string | null;
          language_preference: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          subscription_status: string | null;
          current_period_end: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          plan?: string;
          display_name?: string | null;
          language_preference?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          subscription_status?: string | null;
          current_period_end?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          plan?: string;
          display_name?: string | null;
          language_preference?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          subscription_status?: string | null;
          current_period_end?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "branchmind_user_plans_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      branchmind_user_usage: {
        Row: {
          user_id: string;
          date: string;
          project_count: number;
          node_count: number;
          document_count: number;
          ai_message_count: number;
        };
        Insert: {
          user_id: string;
          date?: string;
          project_count?: number;
          node_count?: number;
          document_count?: number;
          ai_message_count?: number;
        };
        Update: {
          user_id?: string;
          date?: string;
          project_count?: number;
          node_count?: number;
          document_count?: number;
          ai_message_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "branchmind_user_usage_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      branchmind_daily_ai_usage: {
        Row: {
          user_id: string;
          usage_date: string;
          message_count: number;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          usage_date?: string;
          message_count?: number;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          usage_date?: string;
          message_count?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "branchmind_daily_ai_usage_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      branchmind_plan_limits: {
        Row: {
          plan: string;
          max_projects: number | null;
          max_nodes: number | null;
          max_documents: number | null;
          max_ai_messages_per_day: number | null;
        };
        Insert: {
          plan: string;
          max_projects?: number | null;
          max_nodes?: number | null;
          max_documents?: number | null;
          max_ai_messages_per_day?: number | null;
        };
        Update: {
          plan?: string;
          max_projects?: number | null;
          max_nodes?: number | null;
          max_documents?: number | null;
          max_ai_messages_per_day?: number | null;
        };
        Relationships: [];
      };
      branchmind_plan_model_access: {
        Row: {
          plan: string;
          provider_id: string;
          model: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          plan: string;
          provider_id: string;
          model: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          plan?: string;
          provider_id?: string;
          model?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "branchmind_plan_model_access_plan_fkey";
            columns: ["plan"];
            referencedRelation: "branchmind_plan_limits";
            referencedColumns: ["plan"];
          },
          {
            foreignKeyName: "branchmind_plan_model_access_model_fkey";
            columns: ["provider_id", "model"];
            referencedRelation: "branchmind_llm_models";
            referencedColumns: ["provider_id", "model"];
          },
        ];
      };
      branchmind_llm_providers: {
        Row: {
          provider_id: string;
          display_name: string;
          base_url: string;
          api_key_env: string;
          enabled: boolean;
          timeout_ms: number | null;
          payload_options: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          provider_id: string;
          display_name: string;
          base_url: string;
          api_key_env: string;
          enabled?: boolean;
          timeout_ms?: number | null;
          payload_options?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          provider_id?: string;
          display_name?: string;
          base_url?: string;
          api_key_env?: string;
          enabled?: boolean;
          timeout_ms?: number | null;
          payload_options?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      branchmind_llm_models: {
        Row: {
          provider_id: string;
          model: string;
          display_name: string;
          enabled: boolean;
          supports_streaming: boolean;
          supports_json: boolean;
          notes: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          provider_id: string;
          model: string;
          display_name: string;
          enabled?: boolean;
          supports_streaming?: boolean;
          supports_json?: boolean;
          notes?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          provider_id?: string;
          model?: string;
          display_name?: string;
          enabled?: boolean;
          supports_streaming?: boolean;
          supports_json?: boolean;
          notes?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "branchmind_llm_models_provider_id_fkey";
            columns: ["provider_id"];
            referencedRelation: "branchmind_llm_providers";
            referencedColumns: ["provider_id"];
          },
        ];
      };
      branchmind_llm_routes: {
        Row: {
          task: LlmRouteTask;
          default_provider_id: string;
          default_model: string;
          fallback_provider_id: string | null;
          fallback_model: string | null;
          updated_at: string;
        };
        Insert: {
          task: LlmRouteTask;
          default_provider_id: string;
          default_model: string;
          fallback_provider_id?: string | null;
          fallback_model?: string | null;
          updated_at?: string;
        };
        Update: {
          task?: LlmRouteTask;
          default_provider_id?: string;
          default_model?: string;
          fallback_provider_id?: string | null;
          fallback_model?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "branchmind_llm_routes_default_fkey";
            columns: ["default_provider_id", "default_model"];
            referencedRelation: "branchmind_llm_models";
            referencedColumns: ["provider_id", "model"];
          },
          {
            foreignKeyName: "branchmind_llm_routes_fallback_fkey";
            columns: ["fallback_provider_id", "fallback_model"];
            referencedRelation: "branchmind_llm_models";
            referencedColumns: ["provider_id", "model"];
          },
        ];
      };
      branchmind_bug_reports: {
        Row: {
          id: string;
          reporter_user_id: string | null;
          reporter_email: string | null;
          contact_email: string | null;
          title: string;
          description: string;
          status: BugReportStatus;
          current_url: string | null;
          user_agent: string | null;
          screenshot_path: string | null;
          admin_notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          reporter_user_id?: string | null;
          reporter_email?: string | null;
          contact_email?: string | null;
          title: string;
          description: string;
          status?: BugReportStatus;
          current_url?: string | null;
          user_agent?: string | null;
          screenshot_path?: string | null;
          admin_notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          reporter_user_id?: string | null;
          reporter_email?: string | null;
          contact_email?: string | null;
          title?: string;
          description?: string;
          status?: BugReportStatus;
          current_url?: string | null;
          user_agent?: string | null;
          screenshot_path?: string | null;
          admin_notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "branchmind_bug_reports_reporter_user_id_fkey";
            columns: ["reporter_user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      increment_daily_ai_usage: {
        Args: { p_user_id: string };
        Returns: number;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
