CREATE TYPE public.user_action_event_type AS ENUM (
  'check_location',
  'view_images',
  'open_listing',
  'check_amenities',
  'save_property',
  'contact_host'
);

CREATE TABLE public.user_action (
  event_id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  user_type TEXT,
  property_id BIGINT NOT NULL,
  event_type public.user_action_event_type NOT NULL,
  event_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.user_action ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can insert their own actions"
ON public.user_action
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users can view their own actions"
ON public.user_action
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX idx_user_action_user_id ON public.user_action(user_id);
CREATE INDEX idx_user_action_property_id ON public.user_action(property_id);
CREATE INDEX idx_user_action_event_type ON public.user_action(event_type);