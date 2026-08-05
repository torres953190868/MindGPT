import type { BranchType, BugReportStatus, ChatRole, LlmRouteTask } from "@/lib/types";
import type {
  AgentRunStatus,
  AgentStepType,
  AgentType,
} from "@/lib/agent-runtime/agent-run-types";
import type {
  CurriculumEdgeType,
  CurriculumExerciseType,
  CurriculumImportance,
  CurriculumNodeType,
  CurriculumSourceType,
  CurriculumStatus,
  CurriculumSupportType,
  CurriculumVersionStatus,
} from "@/lib/curriculum/curriculum-types";
import type { LearningAssessmentType } from "@/lib/learning/learning-types";

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
          agent_tokens_total: number;
          agent_runs_count: number;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          usage_date?: string;
          message_count?: number;
          agent_tokens_total?: number;
          agent_runs_count?: number;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          usage_date?: string;
          message_count?: number;
          agent_tokens_total?: number;
          agent_runs_count?: number;
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
      curricula: {
        Row: {
          id: string;
          owner_user_id: string;
          project_id: string | null;
          title: string;
          subject: string;
          learning_goal: string;
          status: CurriculumStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          owner_user_id: string;
          project_id?: string | null;
          title: string;
          subject: string;
          learning_goal: string;
          status?: CurriculumStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_user_id?: string;
          project_id?: string | null;
          title?: string;
          subject?: string;
          learning_goal?: string;
          status?: CurriculumStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      curriculum_versions: {
        Row: {
          id: string;
          curriculum_id: string;
          agent_run_id: string | null;
          version_number: number;
          version_label: string;
          status: CurriculumVersionStatus;
          audience: string;
          assumptions_json: Json;
          exclusions_json: Json;
          conflicts_json: Json;
          estimated_weeks: number | null;
          estimated_hours: number | null;
          build_request_json: Json | null;
          validation_json: Json | null;
          created_by: string | null;
          created_at: string;
          published_at: string | null;
        };
        Insert: {
          id: string;
          curriculum_id: string;
          agent_run_id?: string | null;
          version_number: number;
          version_label: string;
          status?: CurriculumVersionStatus;
          audience: string;
          assumptions_json?: Json;
          exclusions_json?: Json;
          conflicts_json?: Json;
          estimated_weeks?: number | null;
          estimated_hours?: number | null;
          build_request_json?: Json | null;
          validation_json?: Json | null;
          created_by?: string | null;
          created_at?: string;
          published_at?: string | null;
        };
        Update: {
          id?: string;
          curriculum_id?: string;
          agent_run_id?: string | null;
          version_number?: number;
          version_label?: string;
          status?: CurriculumVersionStatus;
          audience?: string;
          assumptions_json?: Json;
          exclusions_json?: Json;
          conflicts_json?: Json;
          estimated_weeks?: number | null;
          estimated_hours?: number | null;
          build_request_json?: Json | null;
          validation_json?: Json | null;
          created_by?: string | null;
          created_at?: string;
          published_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "curriculum_versions_curriculum_id_fkey";
            columns: ["curriculum_id"];
            referencedRelation: "curricula";
            referencedColumns: ["id"];
          },
        ];
      };
      curriculum_modules: {
        Row: {
          id: string;
          curriculum_version_id: string;
          title: string;
          description: string;
          order_index: number;
          required: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          curriculum_version_id: string;
          title: string;
          description?: string;
          order_index?: number;
          required?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          curriculum_version_id?: string;
          title?: string;
          description?: string;
          order_index?: number;
          required?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "curriculum_modules_curriculum_version_id_fkey";
            columns: ["curriculum_version_id"];
            referencedRelation: "curriculum_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      curriculum_nodes: {
        Row: {
          id: string;
          curriculum_version_id: string;
          module_id: string;
          title: string;
          summary: string;
          node_type: CurriculumNodeType;
          importance: CurriculumImportance;
          difficulty: number;
          estimated_minutes: number;
          learning_objectives_json: Json;
          completion_criteria_json: Json;
          tags_json: Json;
          order_index: number;
          created_at: string;
        };
        Insert: {
          id: string;
          curriculum_version_id: string;
          module_id: string;
          title: string;
          summary?: string;
          node_type: CurriculumNodeType;
          importance: CurriculumImportance;
          difficulty: number;
          estimated_minutes: number;
          learning_objectives_json?: Json;
          completion_criteria_json?: Json;
          tags_json?: Json;
          order_index?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          curriculum_version_id?: string;
          module_id?: string;
          title?: string;
          summary?: string;
          node_type?: CurriculumNodeType;
          importance?: CurriculumImportance;
          difficulty?: number;
          estimated_minutes?: number;
          learning_objectives_json?: Json;
          completion_criteria_json?: Json;
          tags_json?: Json;
          order_index?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "curriculum_nodes_curriculum_version_id_fkey";
            columns: ["curriculum_version_id"];
            referencedRelation: "curriculum_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "curriculum_nodes_module_id_fkey";
            columns: ["module_id"];
            referencedRelation: "curriculum_modules";
            referencedColumns: ["id"];
          },
        ];
      };
      curriculum_edges: {
        Row: {
          id: string;
          curriculum_version_id: string;
          from_node_id: string;
          to_node_id: string;
          edge_type: CurriculumEdgeType;
          created_at: string;
        };
        Insert: {
          id: string;
          curriculum_version_id: string;
          from_node_id: string;
          to_node_id: string;
          edge_type: CurriculumEdgeType;
          created_at?: string;
        };
        Update: {
          id?: string;
          curriculum_version_id?: string;
          from_node_id?: string;
          to_node_id?: string;
          edge_type?: CurriculumEdgeType;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "curriculum_edges_curriculum_version_id_fkey";
            columns: ["curriculum_version_id"];
            referencedRelation: "curriculum_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "curriculum_edges_from_node_id_fkey";
            columns: ["from_node_id"];
            referencedRelation: "curriculum_nodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "curriculum_edges_to_node_id_fkey";
            columns: ["to_node_id"];
            referencedRelation: "curriculum_nodes";
            referencedColumns: ["id"];
          },
        ];
      };
      curriculum_sources: {
        Row: {
          id: string;
          curriculum_version_id: string;
          url: string;
          canonical_url: string;
          title: string;
          publisher: string | null;
          source_type: CurriculumSourceType;
          retrieved_at: string;
          published_at: string | null;
          quality_score: number;
          content_hash: string | null;
          metadata_json: Json;
          created_at: string;
        };
        Insert: {
          id: string;
          curriculum_version_id: string;
          url: string;
          canonical_url: string;
          title: string;
          publisher?: string | null;
          source_type: CurriculumSourceType;
          retrieved_at: string;
          published_at?: string | null;
          quality_score: number;
          content_hash?: string | null;
          metadata_json?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          curriculum_version_id?: string;
          url?: string;
          canonical_url?: string;
          title?: string;
          publisher?: string | null;
          source_type?: CurriculumSourceType;
          retrieved_at?: string;
          published_at?: string | null;
          quality_score?: number;
          content_hash?: string | null;
          metadata_json?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "curriculum_sources_curriculum_version_id_fkey";
            columns: ["curriculum_version_id"];
            referencedRelation: "curriculum_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      curriculum_node_sources: {
        Row: {
          node_id: string;
          source_id: string;
          support_type: CurriculumSupportType;
          note: string | null;
          created_at: string;
        };
        Insert: {
          node_id: string;
          source_id: string;
          support_type?: CurriculumSupportType;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          node_id?: string;
          source_id?: string;
          support_type?: CurriculumSupportType;
          note?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "curriculum_node_sources_node_id_fkey";
            columns: ["node_id"];
            referencedRelation: "curriculum_nodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "curriculum_node_sources_source_id_fkey";
            columns: ["source_id"];
            referencedRelation: "curriculum_sources";
            referencedColumns: ["id"];
          },
        ];
      };
      curriculum_exercises: {
        Row: {
          id: string;
          curriculum_version_id: string;
          node_id: string;
          exercise_type: CurriculumExerciseType;
          prompt_json: Json;
          rubric_json: Json;
          answer_json: Json | null;
          order_index: number;
          created_at: string;
        };
        Insert: {
          id: string;
          curriculum_version_id: string;
          node_id: string;
          exercise_type: CurriculumExerciseType;
          prompt_json?: Json;
          rubric_json?: Json;
          answer_json?: Json | null;
          order_index?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          curriculum_version_id?: string;
          node_id?: string;
          exercise_type?: CurriculumExerciseType;
          prompt_json?: Json;
          rubric_json?: Json;
          answer_json?: Json | null;
          order_index?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "curriculum_exercises_curriculum_version_id_fkey";
            columns: ["curriculum_version_id"];
            referencedRelation: "curriculum_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "curriculum_exercises_node_id_fkey";
            columns: ["node_id"];
            referencedRelation: "curriculum_nodes";
            referencedColumns: ["id"];
          },
        ];
      };
      curriculum_source_chunks: {
        Row: {
          id: string;
          source_id: string;
          chunk_index: number;
          excerpt: string;
          embedding: number[] | string | null;
          token_count: number;
          content_hash: string;
          created_at: string;
        };
        Insert: {
          id: string;
          source_id: string;
          chunk_index: number;
          excerpt: string;
          embedding?: number[] | null;
          token_count: number;
          content_hash: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          source_id?: string;
          chunk_index?: number;
          excerpt?: string;
          embedding?: number[] | null;
          token_count?: number;
          content_hash?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "curriculum_source_chunks_source_id_fkey";
            columns: ["source_id"];
            referencedRelation: "curriculum_sources";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_runs: {
        Row: {
          id: string;
          agent_type: AgentType;
          user_id: string;
          project_id: string | null;
          curriculum_id: string | null;
          curriculum_version_id: string | null;
          enrollment_id: string | null;
          idempotency_key: string;
          status: AgentRunStatus;
          current_stage: string | null;
          resume_from_stage: string | null;
          model_provider: string | null;
          model_id: string | null;
          input_json: Json;
          output_json: Json | null;
          budget_json: Json;
          usage_json: Json | null;
          error_code: string | null;
          error_message: string | null;
          started_at: string;
          finished_at: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          agent_type: AgentType;
          user_id: string;
          project_id?: string | null;
          curriculum_id?: string | null;
          curriculum_version_id?: string | null;
          enrollment_id?: string | null;
          idempotency_key: string;
          status?: AgentRunStatus;
          current_stage?: string | null;
          resume_from_stage?: string | null;
          model_provider?: string | null;
          model_id?: string | null;
          input_json?: Json;
          output_json?: Json | null;
          budget_json?: Json;
          usage_json?: Json | null;
          error_code?: string | null;
          error_message?: string | null;
          started_at?: string;
          finished_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          agent_type?: AgentType;
          user_id?: string;
          project_id?: string | null;
          curriculum_id?: string | null;
          curriculum_version_id?: string | null;
          enrollment_id?: string | null;
          idempotency_key?: string;
          status?: AgentRunStatus;
          current_stage?: string | null;
          resume_from_stage?: string | null;
          model_provider?: string | null;
          model_id?: string | null;
          input_json?: Json;
          output_json?: Json | null;
          budget_json?: Json;
          usage_json?: Json | null;
          error_code?: string | null;
          error_message?: string | null;
          started_at?: string;
          finished_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_runs_curriculum_id_fkey";
            columns: ["curriculum_id"];
            referencedRelation: "curricula";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_runs_curriculum_version_id_fkey";
            columns: ["curriculum_version_id"];
            referencedRelation: "curriculum_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_steps: {
        Row: {
          id: string;
          run_id: string;
          step_number: number;
          stage: string;
          step_type: AgentStepType;
          tool_name: string | null;
          input_json: Json;
          output_json: Json | null;
          status: string;
          duration_ms: number;
          usage_json: Json | null;
          error_json: Json | null;
          created_at: string;
        };
        Insert: {
          id: string;
          run_id: string;
          step_number: number;
          stage: string;
          step_type: AgentStepType;
          tool_name?: string | null;
          input_json?: Json;
          output_json?: Json | null;
          status: string;
          duration_ms?: number;
          usage_json?: Json | null;
          error_json?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          run_id?: string;
          step_number?: number;
          stage?: string;
          step_type?: AgentStepType;
          tool_name?: string | null;
          input_json?: Json;
          output_json?: Json | null;
          status?: string;
          duration_ms?: number;
          usage_json?: Json | null;
          error_json?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_steps_run_id_fkey";
            columns: ["run_id"];
            referencedRelation: "agent_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_run_events: {
        Row: {
          id: string;
          run_id: string;
          seq: number;
          event_json: Json;
          created_at: string;
        };
        Insert: {
          id: string;
          run_id: string;
          seq: number;
          event_json: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          run_id?: string;
          seq?: number;
          event_json?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_run_events_run_id_fkey";
            columns: ["run_id"];
            referencedRelation: "agent_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_enrollments: {
        Row: {
          id: string;
          user_id: string;
          curriculum_id: string;
          curriculum_version_id: string;
          status: "active" | "completed" | "paused";
          current_node_id: string | null;
          started_at: string;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          user_id: string;
          curriculum_id: string;
          curriculum_version_id: string;
          status?: "active" | "completed" | "paused";
          current_node_id?: string | null;
          started_at?: string;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          curriculum_id?: string;
          curriculum_version_id?: string;
          status?: "active" | "completed" | "paused";
          current_node_id?: string | null;
          started_at?: string;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      learning_node_progress: {
        Row: {
          id: string;
          enrollment_id: string;
          node_id: string;
          status: "locked" | "available" | "in_progress" | "needs_review" | "completed";
          mastery_score: number;
          attempt_count: number;
          last_evidence_json: Json | null;
          last_assessed_at: string | null;
          next_review_at: string | null;
          started_at: string | null;
          completed_at: string | null;
          updated_at: string;
        };
        Insert: {
          id: string;
          enrollment_id: string;
          node_id: string;
          status?: "locked" | "available" | "in_progress" | "needs_review" | "completed";
          mastery_score?: number;
          attempt_count?: number;
          last_evidence_json?: Json | null;
          last_assessed_at?: string | null;
          next_review_at?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          enrollment_id?: string;
          node_id?: string;
          status?: "locked" | "available" | "in_progress" | "needs_review" | "completed";
          mastery_score?: number;
          attempt_count?: number;
          last_evidence_json?: Json | null;
          last_assessed_at?: string | null;
          next_review_at?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      learning_sessions: {
        Row: {
          id: string;
          enrollment_id: string;
          node_id: string | null;
          skill_id: string | null;
          status: "active" | "ended" | "abandoned";
          started_at: string;
          ended_at: string | null;
          summary: string;
          created_at: string;
        };
        Insert: {
          id: string;
          enrollment_id: string;
          node_id?: string | null;
          skill_id?: string | null;
          status?: "active" | "ended" | "abandoned";
          started_at?: string;
          ended_at?: string | null;
          summary?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          enrollment_id?: string;
          node_id?: string | null;
          skill_id?: string | null;
          status?: "active" | "ended" | "abandoned";
          started_at?: string;
          ended_at?: string | null;
          summary?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      learning_messages: {
        Row: {
          id: string;
          session_id: string;
          enrollment_id: string;
          role: "user" | "assistant" | "system_event";
          blocks_json: Json;
          agent_run_id: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          session_id: string;
          enrollment_id: string;
          role: "user" | "assistant" | "system_event";
          blocks_json?: Json;
          agent_run_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          enrollment_id?: string;
          role?: "user" | "assistant" | "system_event";
          blocks_json?: Json;
          agent_run_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      learning_assessments: {
        Row: {
          id: string;
          session_id: string;
          enrollment_id: string;
          node_id: string;
          exercise_id: string | null;
          assessment_type: LearningAssessmentType;
          prompt_json: Json;
          answer_json: Json | null;
          rubric_json: Json;
          score: number;
          evidence_json: Json;
          answer_hash: string;
          agent_run_id: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          session_id: string;
          enrollment_id: string;
          node_id: string;
          exercise_id?: string | null;
          assessment_type: LearningAssessmentType;
          prompt_json?: Json;
          answer_json?: Json | null;
          rubric_json?: Json;
          score: number;
          evidence_json?: Json;
          answer_hash: string;
          agent_run_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          enrollment_id?: string;
          node_id?: string;
          exercise_id?: string | null;
          assessment_type?: LearningAssessmentType;
          prompt_json?: Json;
          answer_json?: Json;
          rubric_json?: Json;
          score?: number;
          evidence_json?: Json;
          answer_hash?: string;
          agent_run_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      idempotency_keys: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          key: string;
          response_json: Json | null;
          status_code: number | null;
          created_at: string;
        };
        Insert: {
          id: string;
          user_id: string;
          endpoint: string;
          key: string;
          response_json?: Json | null;
          status_code?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          endpoint?: string;
          key?: string;
          response_json?: Json | null;
          status_code?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      security_events: {
        Row: {
          id: string;
          user_id: string | null;
          run_id: string | null;
          rule: string;
          domain: string | null;
          content_hash: string;
          metadata_json: Json;
          created_at: string;
        };
        Insert: {
          id: string;
          user_id?: string | null;
          run_id?: string | null;
          rule: string;
          domain?: string | null;
          content_hash: string;
          metadata_json?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          run_id?: string | null;
          rule?: string;
          domain?: string | null;
          content_hash?: string;
          metadata_json?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      increment_daily_ai_usage: {
        Args: { p_user_id: string };
        Returns: number;
      };
      increment_daily_agent_usage: {
        Args: { p_user_id: string; p_tokens: number; p_runs_count: number };
        Returns: undefined;
      };
      allocate_curriculum_version_number: {
        Args: { p_curriculum_id: string };
        Returns: number;
      };
      publish_curriculum_version: {
        Args: { p_curriculum_id: string; p_version_id: string };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
