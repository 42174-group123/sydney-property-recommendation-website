export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      hosts: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          host_since: string | null;
          listing_interested: number[];
          published_listings: number[];
          saved_listings: number[];
          user_id: string;
          user_type: string | null;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          host_since?: string | null;
          listing_interested?: number[];
          published_listings?: number[];
          saved_listings?: number[];
          user_id: string;
          user_type?: string | null;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          host_since?: string | null;
          listing_interested?: number[];
          published_listings?: number[];
          saved_listings?: number[];
          user_id?: string;
          user_type?: string | null;
        };
        Relationships: [];
      };
      listings: {
        Row: {
          accommodates: number | null;
          amenities: Json | null;
          availability_30: number | null;
          availability_365: number | null;
          availability_60: number | null;
          availability_90: number | null;
          availability_eoy: number | null;
          bathrooms: string | null;
          bathrooms_text: string | null;
          bedrooms: string | null;
          beds: string | null;
          calculated_host_listings_count: number | null;
          calculated_host_listings_count_entire_homes: number | null;
          calculated_host_listings_count_private_rooms: number | null;
          calculated_host_listings_count_shared_rooms: number | null;
          calendar_last_scraped: string | null;
          calendar_updated: string | null;
          description: string | null;
          estimated_occupancy_l365d: number | null;
          estimated_revenue_l365d: string | null;
          first_review: string | null;
          has_availability: string | null;
          host_about: string | null;
          host_acceptance_rate: string | null;
          host_has_profile_pic: string | null;
          host_id: number | null;
          host_identity_verified: string | null;
          host_is_superhost: string | null;
          host_listings_count: number | null;
          host_location: string | null;
          host_name: string | null;
          host_neighbourhood: string | null;
          host_picture_url: string | null;
          host_response_rate: string | null;
          host_response_time: string | null;
          host_since: string | null;
          host_thumbnail_url: string | null;
          host_total_listings_count: number | null;
          host_url: string | null;
          host_verifications: string | null;
          id: number;
          instant_bookable: string | null;
          last_review: string | null;
          last_scraped: string | null;
          latitude: number | null;
          license: string | null;
          listing_url: string | null;
          longitude: number | null;
          maximum_maximum_nights: number | null;
          maximum_minimum_nights: number | null;
          maximum_nights: number | null;
          maximum_nights_avg_ntm: string | null;
          minimum_maximum_nights: number | null;
          minimum_minimum_nights: number | null;
          minimum_nights: number | null;
          minimum_nights_avg_ntm: number | null;
          name: string | null;
          neighborhood_overview: string | null;
          neighbourhood: string | null;
          neighbourhood_cleansed: string | null;
          neighbourhood_group_cleansed: string | null;
          number_of_reviews: number | null;
          number_of_reviews_l30d: number | null;
          number_of_reviews_ltm: number | null;
          number_of_reviews_ly: number | null;
          picture_url: string | null;
          price: string | null;
          property_type: string | null;
          review_scores_accuracy: string | null;
          review_scores_checkin: string | null;
          review_scores_cleanliness: string | null;
          review_scores_communication: string | null;
          review_scores_location: string | null;
          review_scores_rating: string | null;
          review_scores_value: string | null;
          reviews_per_month: string | null;
          room_type: string | null;
          scrape_id: number | null;
          source: string | null;
        };
        Insert: {
          accommodates?: number | null;
          amenities?: Json | null;
          availability_30?: number | null;
          availability_365?: number | null;
          availability_60?: number | null;
          availability_90?: number | null;
          availability_eoy?: number | null;
          bathrooms?: string | null;
          bathrooms_text?: string | null;
          bedrooms?: string | null;
          beds?: string | null;
          calculated_host_listings_count?: number | null;
          calculated_host_listings_count_entire_homes?: number | null;
          calculated_host_listings_count_private_rooms?: number | null;
          calculated_host_listings_count_shared_rooms?: number | null;
          calendar_last_scraped?: string | null;
          calendar_updated?: string | null;
          description?: string | null;
          estimated_occupancy_l365d?: number | null;
          estimated_revenue_l365d?: string | null;
          first_review?: string | null;
          has_availability?: string | null;
          host_about?: string | null;
          host_acceptance_rate?: string | null;
          host_has_profile_pic?: string | null;
          host_id?: number | null;
          host_identity_verified?: string | null;
          host_is_superhost?: string | null;
          host_listings_count?: number | null;
          host_location?: string | null;
          host_name?: string | null;
          host_neighbourhood?: string | null;
          host_picture_url?: string | null;
          host_response_rate?: string | null;
          host_response_time?: string | null;
          host_since?: string | null;
          host_thumbnail_url?: string | null;
          host_total_listings_count?: number | null;
          host_url?: string | null;
          host_verifications?: string | null;
          id: number;
          instant_bookable?: string | null;
          last_review?: string | null;
          last_scraped?: string | null;
          latitude?: number | null;
          license?: string | null;
          listing_url?: string | null;
          longitude?: number | null;
          maximum_maximum_nights?: number | null;
          maximum_minimum_nights?: number | null;
          maximum_nights?: number | null;
          maximum_nights_avg_ntm?: string | null;
          minimum_maximum_nights?: number | null;
          minimum_minimum_nights?: number | null;
          minimum_nights?: number | null;
          minimum_nights_avg_ntm?: number | null;
          name?: string | null;
          neighborhood_overview?: string | null;
          neighbourhood?: string | null;
          neighbourhood_cleansed?: string | null;
          neighbourhood_group_cleansed?: string | null;
          number_of_reviews?: number | null;
          number_of_reviews_l30d?: number | null;
          number_of_reviews_ltm?: number | null;
          number_of_reviews_ly?: number | null;
          picture_url?: string | null;
          price?: string | null;
          property_type?: string | null;
          review_scores_accuracy?: string | null;
          review_scores_checkin?: string | null;
          review_scores_cleanliness?: string | null;
          review_scores_communication?: string | null;
          review_scores_location?: string | null;
          review_scores_rating?: string | null;
          review_scores_value?: string | null;
          reviews_per_month?: string | null;
          room_type?: string | null;
          scrape_id?: number | null;
          source?: string | null;
        };
        Update: {
          accommodates?: number | null;
          amenities?: Json | null;
          availability_30?: number | null;
          availability_365?: number | null;
          availability_60?: number | null;
          availability_90?: number | null;
          availability_eoy?: number | null;
          bathrooms?: string | null;
          bathrooms_text?: string | null;
          bedrooms?: string | null;
          beds?: string | null;
          calculated_host_listings_count?: number | null;
          calculated_host_listings_count_entire_homes?: number | null;
          calculated_host_listings_count_private_rooms?: number | null;
          calculated_host_listings_count_shared_rooms?: number | null;
          calendar_last_scraped?: string | null;
          calendar_updated?: string | null;
          description?: string | null;
          estimated_occupancy_l365d?: number | null;
          estimated_revenue_l365d?: string | null;
          first_review?: string | null;
          has_availability?: string | null;
          host_about?: string | null;
          host_acceptance_rate?: string | null;
          host_has_profile_pic?: string | null;
          host_id?: number | null;
          host_identity_verified?: string | null;
          host_is_superhost?: string | null;
          host_listings_count?: number | null;
          host_location?: string | null;
          host_name?: string | null;
          host_neighbourhood?: string | null;
          host_picture_url?: string | null;
          host_response_rate?: string | null;
          host_response_time?: string | null;
          host_since?: string | null;
          host_thumbnail_url?: string | null;
          host_total_listings_count?: number | null;
          host_url?: string | null;
          host_verifications?: string | null;
          id?: number;
          instant_bookable?: string | null;
          last_review?: string | null;
          last_scraped?: string | null;
          latitude?: number | null;
          license?: string | null;
          listing_url?: string | null;
          longitude?: number | null;
          maximum_maximum_nights?: number | null;
          maximum_minimum_nights?: number | null;
          maximum_nights?: number | null;
          maximum_nights_avg_ntm?: string | null;
          minimum_maximum_nights?: number | null;
          minimum_minimum_nights?: number | null;
          minimum_nights?: number | null;
          minimum_nights_avg_ntm?: number | null;
          name?: string | null;
          neighborhood_overview?: string | null;
          neighbourhood?: string | null;
          neighbourhood_cleansed?: string | null;
          neighbourhood_group_cleansed?: string | null;
          number_of_reviews?: number | null;
          number_of_reviews_l30d?: number | null;
          number_of_reviews_ltm?: number | null;
          number_of_reviews_ly?: number | null;
          picture_url?: string | null;
          price?: string | null;
          property_type?: string | null;
          review_scores_accuracy?: string | null;
          review_scores_checkin?: string | null;
          review_scores_cleanliness?: string | null;
          review_scores_communication?: string | null;
          review_scores_location?: string | null;
          review_scores_rating?: string | null;
          review_scores_value?: string | null;
          reviews_per_month?: string | null;
          room_type?: string | null;
          scrape_id?: number | null;
          source?: string | null;
        };
        Relationships: [];
      };
      user_action: {
        Row: {
          event_id: string;
          event_timestamp: string;
          event_type: Database["public"]["Enums"]["user_action_event_type"];
          property_id: number;
          user_id: string;
          user_type: string | null;
        };
        Insert: {
          event_id?: string;
          event_timestamp?: string;
          event_type: Database["public"]["Enums"]["user_action_event_type"];
          property_id: number;
          user_id: string;
          user_type?: string | null;
        };
        Update: {
          event_id?: string;
          event_timestamp?: string;
          event_type?: Database["public"]["Enums"]["user_action_event_type"];
          property_id?: number;
          user_id?: string;
          user_type?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      filter_listings: {
        Args: {
          p_instant_bookable?: boolean;
          p_limit?: number;
          p_max_price?: number;
          p_min_accommodates?: number;
          p_min_bathrooms?: number;
          p_min_bedrooms?: number;
          p_min_beds?: number;
          p_min_nights?: number;
          p_min_price?: number;
          p_neighbourhood?: string;
          p_offset?: number;
        };
        Returns: {
          host_picture_url: string;
          id: number;
          name: string;
          picture_url: string;
          price: string;
        }[];
      };
    };
    Enums: {
      user_action_event_type:
        | "check_location"
        | "view_images"
        | "open_listing"
        | "check_amenities"
        | "save_property"
        | "contact_host";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      user_action_event_type: [
        "check_location",
        "view_images",
        "open_listing",
        "check_amenities",
        "save_property",
        "contact_host",
      ],
    },
  },
} as const;
