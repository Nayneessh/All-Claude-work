-- Default settings and SAMPLE routine templates for testing.
-- Sample templates are marked sample = true and approved = false. They are shown only when the
-- setting allow_sample_routines is true (staging), and are then labelled as samples on screen.
-- The cosmetologist replaces them in the console; saving with "approve" makes a template real.

insert into ss.settings (key, value) values
  ('allow_sample_routines', 'true'::jsonb),
  ('gate_b_min_confidence', '"not_sure"'::jsonb),
  ('retention_unbooked_hours', '72'::jsonb),
  ('retention_closed_days', '90'::jsonb),
  ('service_promise', '"first reply within one business day"'::jsonb),
  ('maintenance_mode', 'false'::jsonb)
on conflict (key) do nothing;

do $$
declare
  s int; f text; v text;
  cleanser_en text; cleanser_hi text; moist_en text; moist_hi text; items jsonb;
begin
  for s in select unnest(array[2, 3]) loop
    foreach f in array array['dry', 'balanced', 'oily'] loop
      foreach v in array array['low', 'high'] loop
        cleanser_en := case f when 'dry' then 'A mild, non-foaming face cleanser' when 'balanced' then 'A gentle everyday face cleanser' else 'A gentle gel-type face cleanser' end;
        cleanser_hi := case f when 'dry' then 'एक हल्का, बिना झाग वाला फ़ेस क्लींज़र' when 'balanced' then 'रोज़ के लिए एक सौम्य फ़ेस क्लींज़र' else 'एक सौम्य जेल-टाइप फ़ेस क्लींज़र' end;
        moist_en := case f when 'dry' then 'A richer moisturiser' when 'balanced' then 'A light moisturiser' else 'A light, oil-free moisturiser' end;
        moist_hi := case f when 'dry' then 'एक गाढ़ा मॉइस्चराइज़र' when 'balanced' then 'एक हल्का मॉइस्चराइज़र' else 'एक हल्का, तेल-रहित मॉइस्चराइज़र' end;
        if v = 'high' then
          cleanser_en := cleanser_en || '. Choose a fragrance-free one.';
          cleanser_hi := cleanser_hi || '। बिना सुगंध वाला चुनें।';
        else
          cleanser_en := cleanser_en || '.';
          cleanser_hi := cleanser_hi || '।';
        end if;
        items := jsonb_build_array(
          jsonb_build_object('category', 'cleanser', 'text_en', cleanser_en || ' Morning and evening.', 'text_hi', cleanser_hi || ' सुबह और शाम।'),
          jsonb_build_object('category', 'moisturiser', 'text_en', moist_en || ' after cleansing.', 'text_hi', moist_hi || ' क्लींज़िंग के बाद।')
        );
        if s = 3 then
          items := items || jsonb_build_array(jsonb_build_object('category', 'sunscreen', 'text_en', 'A broad-spectrum sunscreen as the last step each morning.', 'text_hi', 'हर सुबह आख़िरी चरण के रूप में एक ब्रॉड-स्पेक्ट्रम सनस्क्रीन।'));
        end if;
        insert into ss.routine_templates (name, steps, skin_feel, sensitivity, budget_bands, items, approved, sample)
        values ('SAMPLE ' || s || ' steps, ' || f || ' skin, ' || v || ' sensitivity', s, f, v, '{}', items, false, true);
      end loop;
    end loop;
  end loop;
end $$;
