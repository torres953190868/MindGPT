import type { BranchType, ChatRole } from "@/lib/types";

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
          page_count: number;
          title: string | null;
          status: "uploaded" | "parsing" | "parsed" | "indexing" | "indexed" | "failed";
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
          page_count?: number;
          title?: string | null;
          status?: "uploaded" | "parsing" | "parsed" | "indexing" | "indexed" | "failed";
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
          page_count?: number;
          title?: string | null;
          status?: "uploaded" | "parsing" | "parsed" | "indexing" | "indexed" | "failed";
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
