begin;
set local search_path = public, extensions, pg_catalog;

-- Keep the deployed input parameter name for CREATE OR REPLACE compatibility, but
-- use positional input and distinct JSON aliases so PL/pgSQL never confuses the
-- parameter `value` with jsonb_array_elements' output column.
create or replace function private.valid_structured_study_goals(value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare goal jsonb; milestone jsonb; link jsonb; goal_pos integer; milestone_pos integer; total integer := 0;
begin
  if not private.valid_study_goals($1) then return false; end if;
  for goal, goal_pos in select goal_items.entry,goal_items.ordinality::integer
    from jsonb_array_elements($1) with ordinality as goal_items(entry,ordinality) loop
    if jsonb_typeof(goal->'position')<>'number' or (goal->>'position')::integer<>goal_pos
      or nullif(btrim(goal->>'topic'),'') is null or length(goal->>'topic')>200
      or coalesce(goal->>'targetDate','') !~ '^\d{4}-\d{2}-\d{2}$'
      or nullif(btrim(goal->>'baseline'),'') is null or length(goal->>'baseline')>2000
      or nullif(btrim(goal->>'schedule'),'') is null or length(goal->>'schedule')>500
      or nullif(btrim(goal->>'successCriterion'),'') is null or length(goal->>'successCriterion')>1000 then return false; end if;
    for milestone,milestone_pos in select milestone_items.entry,milestone_items.ordinality::integer
      from jsonb_array_elements(goal->'milestones') with ordinality as milestone_items(entry,ordinality) loop
      total:=total+1;
      if jsonb_typeof(milestone->'position')<>'number' or (milestone->>'position')::integer<>milestone_pos
        or coalesce(milestone->>'status','') not in ('planned','in_progress','completed','blocked')
        or (milestone ? 'targetDate' and milestone->'targetDate'<>'null'::jsonb
          and coalesce(milestone->>'targetDate','') !~ '^\d{4}-\d{2}-\d{2}$')
        or jsonb_typeof(milestone->'links') is distinct from 'array'
        or jsonb_array_length(milestone->'links')>20 then return false; end if;
      for link in select link_items.entry from jsonb_array_elements(milestone->'links') as link_items(entry) loop
        if coalesce(link->>'kind','') not in ('resource','assignment','assessment')
          or coalesce(link->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return false; end if;
      end loop;
    end loop;
  end loop;
  return total<=100;
exception when others then return false;
end;
$$;

commit;
