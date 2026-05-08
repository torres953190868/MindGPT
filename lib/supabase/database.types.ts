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
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id: string;
          project_id: string;
          node_id: string;
          role: ChatRole;
          content: string;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          node_id?: string;
          role?: ChatRole;
          content?: string;
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
