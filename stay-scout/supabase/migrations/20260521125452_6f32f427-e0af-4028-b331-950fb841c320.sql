create or replace function public.filter_listings(
  p_offset int default 0,
  p_limit int default 20,
  p_min_accommodates int default null,
  p_min_bathrooms numeric default null,
  p_min_bedrooms numeric default null,
  p_min_beds numeric default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_min_nights int default null,
  p_instant_bookable boolean default null,
  p_neighbourhood text default null
)
returns table(id bigint, name text, picture_url text, host_picture_url text)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.name, l.picture_url, l.host_picture_url
  from public.listings l
  where (p_min_accommodates is null or l.accommodates >= p_min_accommodates)
    and (p_min_bathrooms is null or nullif(regexp_replace(coalesce(l.bathrooms,''), '[^0-9.]', '', 'g'), '')::numeric >= p_min_bathrooms)
    and (p_min_bedrooms is null or nullif(regexp_replace(coalesce(l.bedrooms,''), '[^0-9.]', '', 'g'), '')::numeric >= p_min_bedrooms)
    and (p_min_beds is null or nullif(regexp_replace(coalesce(l.beds,''), '[^0-9.]', '', 'g'), '')::numeric >= p_min_beds)
    and (p_min_price is null or nullif(regexp_replace(coalesce(l.price,''), '[^0-9.]', '', 'g'), '')::numeric >= p_min_price)
    and (p_max_price is null or nullif(regexp_replace(coalesce(l.price,''), '[^0-9.]', '', 'g'), '')::numeric <= p_max_price)
    and (p_min_nights is null or l.minimum_nights >= p_min_nights)
    and (p_instant_bookable is null or p_instant_bookable = false or l.instant_bookable = 't')
    and (p_neighbourhood is null or lower(l.neighbourhood_cleansed) = lower(p_neighbourhood))
  order by l.id asc
  offset p_offset
  limit p_limit;
$$;

grant execute on function public.filter_listings(int,int,int,numeric,numeric,numeric,numeric,numeric,int,boolean,text) to anon, authenticated;