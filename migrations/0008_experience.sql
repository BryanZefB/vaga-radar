UPDATE settings SET profile=json_set(profile,'$.experienceYears',2) WHERE id=1 AND json_extract(profile,'$.experienceYears') IS NULL;
