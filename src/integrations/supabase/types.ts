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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      credit_repayments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          method: string
          shop_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          method?: string
          shop_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          method?: string
          shop_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_repayments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_repayments_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          credit_limit: number
          id: string
          name: string
          phone: string | null
          shop_id: string | null
        }
        Insert: {
          created_at?: string
          credit_limit?: number
          id?: string
          name: string
          phone?: string | null
          shop_id?: string | null
        }
        Update: {
          created_at?: string
          credit_limit?: number
          id?: string
          name?: string
          phone?: string | null
          shop_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: Database["public"]["Enums"]["expense_category"]
          created_at: string
          date: string
          description: string
          id: string
          recorded_by: string | null
          shop_id: string | null
        }
        Insert: {
          amount?: number
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          date?: string
          description?: string
          id?: string
          recorded_by?: string | null
          shop_id?: string | null
        }
        Update: {
          amount?: number
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          date?: string
          description?: string
          id?: string
          recorded_by?: string | null
          shop_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      mpesa_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          matched_sale_id: string | null
          paid_at: string
          payer_name: string | null
          payer_phone: string | null
          raw_payload: Json | null
          shop_id: string | null
          transaction_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          matched_sale_id?: string | null
          paid_at?: string
          payer_name?: string | null
          payer_phone?: string | null
          raw_payload?: Json | null
          shop_id?: string | null
          transaction_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          matched_sale_id?: string | null
          paid_at?: string
          payer_name?: string | null
          payer_phone?: string | null
          raw_payload?: Json | null
          shop_id?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mpesa_payments_matched_sale_id_fkey"
            columns: ["matched_sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mpesa_payments_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          barcode: string | null
          barcode_internal: boolean
          category: string
          created_at: string
          id: string
          low_stock_threshold: number
          name: string
          price: number
          quantity: number
          shop_id: string | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          barcode_internal?: boolean
          category?: string
          created_at?: string
          id?: string
          low_stock_threshold?: number
          name: string
          price?: number
          quantity?: number
          shop_id?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          barcode_internal?: boolean
          category?: string
          created_at?: string
          id?: string
          low_stock_threshold?: number
          name?: string
          price?: number
          quantity?: number
          shop_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
          lang: string
        }
        Insert: {
          created_at?: string
          display_name?: string
          id: string
          lang?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          lang?: string
        }
        Relationships: []
      }
      sale_items: {
        Row: {
          barcode: string | null
          created_at: string
          id: string
          line_total: number
          product_id: string | null
          product_name: string
          quantity: number
          sale_id: string
          shop_id: string | null
          unit_price: number
        }
        Insert: {
          barcode?: string | null
          created_at?: string
          id?: string
          line_total?: number
          product_id?: string | null
          product_name: string
          quantity?: number
          sale_id: string
          shop_id?: string | null
          unit_price?: number
        }
        Update: {
          barcode?: string | null
          created_at?: string
          id?: string
          line_total?: number
          product_id?: string | null
          product_name?: string
          quantity?: number
          sale_id?: string
          shop_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          amount_paid: number
          checkout_request_id: string | null
          client_ref: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          id: string
          item_count: number
          note: string | null
          payment_method: string
          payment_status: string
          shop_id: string | null
          stock_conflict: boolean
          total: number
        }
        Insert: {
          amount_paid?: number
          checkout_request_id?: string | null
          client_ref?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          item_count?: number
          note?: string | null
          payment_method?: string
          payment_status?: string
          shop_id?: string | null
          stock_conflict?: boolean
          total?: number
        }
        Update: {
          amount_paid?: number
          checkout_request_id?: string | null
          client_ref?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          item_count?: number
          note?: string | null
          payment_method?: string
          payment_status?: string
          shop_id?: string | null
          stock_conflict?: boolean
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_settings: {
        Row: {
          close_time: string
          enforce_hours: boolean
          id: number
          open_time: string
          shop_id: string | null
          shop_name: string
          timezone: string
        }
        Insert: {
          close_time?: string
          enforce_hours?: boolean
          id?: number
          open_time?: string
          shop_id?: string | null
          shop_name?: string
          timezone?: string
        }
        Update: {
          close_time?: string
          enforce_hours?: boolean
          id?: number
          open_time?: string
          shop_id?: string | null
          shop_name?: string
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_settings_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: true
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shops: {
        Row: {
          created_at: string
          id: string
          join_code: string
          monthly_fee: number
          name: string
          owner_id: string | null
          paid_until: string | null
          suspended: boolean
          trial_ends_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          join_code?: string
          monthly_fee?: number
          name: string
          owner_id?: string | null
          paid_until?: string | null
          suspended?: boolean
          trial_ends_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          join_code?: string
          monthly_fee?: number
          name?: string
          owner_id?: string | null
          paid_until?: string | null
          suspended?: boolean
          trial_ends_at?: string
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          change: number
          created_at: string
          id: string
          product_id: string | null
          reason: string
          resulting_quantity: number | null
          sale_id: string | null
          shop_id: string | null
        }
        Insert: {
          change: number
          created_at?: string
          id?: string
          product_id?: string | null
          reason?: string
          resulting_quantity?: number | null
          sale_id?: string | null
          shop_id?: string | null
        }
        Update: {
          change?: number
          created_at?: string
          id?: string
          product_id?: string | null
          reason?: string
          resulting_quantity?: number | null
          sale_id?: string | null
          shop_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          shop_id: string | null
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          shop_id?: string | null
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          shop_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_list_shops: {
        Args: never
        Returns: {
          active: boolean
          created_at: string
          id: string
          join_code: string
          last_sale_at: string
          monthly_fee: number
          name: string
          owner_email: string
          paid_until: string
          product_count: number
          sales_30d: number
          staff_count: number
          suspended: boolean
          trial_ends_at: string
        }[]
      }
      admin_update_shop: {
        Args: {
          p_add_months?: number
          p_extend_trial_days?: number
          p_shop: string
          p_suspended?: boolean
        }
        Returns: undefined
      }
      can_operate: { Args: never; Returns: boolean }
      checkout_sale: {
        Args: {
          p_items: Json
          p_payment_method?: string
          p_payment_status?: string
        }
        Returns: string
      }
      checkout_sale_v2: {
        Args: {
          p_client_ref?: string
          p_created_at?: string
          p_customer_id?: string
          p_items: Json
          p_payment_method?: string
        }
        Returns: string
      }
      claim_role: { Args: never; Returns: string }
      create_shop: { Args: { p_name: string }; Returns: string }
      current_shop_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      join_shop: { Args: { p_code: string }; Returns: string }
      record_repayment: {
        Args: { p_amount: number; p_customer_id: string; p_method?: string }
        Returns: number
      }
      shop_active: { Args: { _shop: string }; Returns: boolean }
      shop_is_open: { Args: never; Returns: boolean }
    }
    Enums: {
      app_role: "owner" | "seller"
      expense_category:
        | "rent"
        | "restocking"
        | "transport"
        | "wages"
        | "utilities"
        | "other"
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
  public: {
    Enums: {
      app_role: ["owner", "seller"],
      expense_category: [
        "rent",
        "restocking",
        "transport",
        "wages",
        "utilities",
        "other",
      ],
    },
  },
} as const
