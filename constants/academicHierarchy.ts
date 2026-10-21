/**
 * Standard Academic Hierarchy for Nigerian Universities
 * Curated standard faculties, departments, and zero-AI deduplication utilities.
 */

export interface AcademicOption {
  id: string;
  name: string;
  short_name?: string;
  college_id?: string;
  aliases?: string[];
}

export const sanitizeAcademicId = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

/**
 * Normalizes an academic entity name (stripping prefixes like "Faculty of", "Dept of", symbols, etc.)
 * so that synonyms, slight variations, and abbreviations map to the exact same canonical root.
 */
export const normalizeAcademicName = (name: string): string => {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/^(faculty of|college of|school of|department of|dept of|dept\. of)\s+/i, '')
    .replace(/[&]/g, 'and')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Curated standard faculties across Nigerian higher institutions.
 */
export const STANDARD_FACULTIES: AcademicOption[] = [
  { id: 'faculty_of_engineering', name: 'Faculty of Engineering & Technology', short_name: 'ENG', aliases: ['Engineering', 'Technology'] },
  { id: 'faculty_of_science', name: 'Faculty of Science', short_name: 'SCI', aliases: ['Sciences', 'Natural Sciences', 'Pure and Applied Sciences'] },
  { id: 'college_of_medicine', name: 'College of Medical & Health Sciences', short_name: 'MED', aliases: ['Medicine', 'Health Sciences', 'Basic Medical Sciences', 'Clinical Sciences'] },
  { id: 'faculty_of_law', name: 'Faculty of Law', short_name: 'LAW', aliases: ['Law', 'Legal Studies'] },
  { id: 'faculty_of_social_sciences', name: 'Faculty of Social Sciences', short_name: 'SOC', aliases: ['Social Sciences'] },
  { id: 'faculty_of_management_sciences', name: 'Faculty of Management Sciences', short_name: 'MGT', aliases: ['Management Sciences', 'Business Administration', 'Administration'] },
  { id: 'faculty_of_arts', name: 'Faculty of Arts & Humanities', short_name: 'ART', aliases: ['Arts', 'Humanities'] },
  { id: 'faculty_of_environmental_sciences', name: 'Faculty of Environmental Sciences', short_name: 'ENV', aliases: ['Environmental Sciences', 'Environmental Studies'] },
  { id: 'faculty_of_education', name: 'Faculty of Education', short_name: 'EDU', aliases: ['Education'] },
  { id: 'faculty_of_agriculture', name: 'Faculty of Agriculture', short_name: 'AGR', aliases: ['Agriculture', 'Agricultural Sciences'] },
  { id: 'faculty_of_pharmacy', name: 'Faculty of Pharmacy', short_name: 'PHARM', aliases: ['Pharmacy', 'Pharmaceutical Sciences'] },
  { id: 'faculty_of_veterinary_medicine', name: 'Faculty of Veterinary Medicine', short_name: 'VET', aliases: ['Veterinary Medicine'] },
];

/**
 * Curated standard departments across Nigerian universities.
 */
export const STANDARD_DEPARTMENTS: AcademicOption[] = [
  // Engineering
  { id: 'computer_engineering', name: 'Computer Engineering', college_id: 'faculty_of_engineering', short_name: 'CPE', aliases: ['Comp Eng', 'Computer Eng'] },
  { id: 'electrical_electronics_engineering', name: 'Electrical & Electronics Engineering', college_id: 'faculty_of_engineering', short_name: 'EEE', aliases: ['Electrical Engineering', 'Elect Elect'] },
  { id: 'mechanical_engineering', name: 'Mechanical Engineering', college_id: 'faculty_of_engineering', short_name: 'ME', aliases: ['Mech Eng'] },
  { id: 'civil_engineering', name: 'Civil Engineering', college_id: 'faculty_of_engineering', short_name: 'CE', aliases: ['Civil Eng'] },
  { id: 'chemical_engineering', name: 'Chemical Engineering', college_id: 'faculty_of_engineering', short_name: 'CHE', aliases: ['Chem Eng'] },
  { id: 'petroleum_gas_engineering', name: 'Petroleum & Gas Engineering', college_id: 'faculty_of_engineering', short_name: 'PET', aliases: ['Petroleum Engineering', 'Pet Eng'] },
  { id: 'mechatronics_engineering', name: 'Mechatronics Engineering', college_id: 'faculty_of_engineering', short_name: 'MCE', aliases: ['Mechatronics'] },
  { id: 'agricultural_bioresources_engineering', name: 'Agricultural & Bioresources Engineering', college_id: 'faculty_of_engineering', short_name: 'ABE', aliases: ['Agric Engineering'] },
  { id: 'metallurgical_materials_engineering', name: 'Metallurgical & Materials Engineering', college_id: 'faculty_of_engineering', short_name: 'MME', aliases: ['Materials Engineering'] },
  { id: 'systems_engineering', name: 'Systems Engineering', college_id: 'faculty_of_engineering', short_name: 'SE' },
  { id: 'industrial_production_engineering', name: 'Industrial & Production Engineering', college_id: 'faculty_of_engineering', short_name: 'IPE' },
  { id: 'biomedical_engineering', name: 'Biomedical Engineering', college_id: 'faculty_of_engineering', short_name: 'BME' },
  { id: 'marine_engineering', name: 'Marine Engineering', college_id: 'faculty_of_engineering', short_name: 'MAR' },

  // Sciences
  { id: 'computer_science', name: 'Computer Science', college_id: 'faculty_of_science', short_name: 'CSC', aliases: ['CS', 'Comp Sci', 'Computing'] },
  { id: 'software_engineering', name: 'Software Engineering', college_id: 'faculty_of_science', short_name: 'SWE', aliases: ['Software Eng'] },
  { id: 'cybersecurity', name: 'Cybersecurity & Information Security', college_id: 'faculty_of_science', short_name: 'CYB', aliases: ['Cyber Security', 'InfoSec'] },
  { id: 'data_science_ai', name: 'Data Science & Artificial Intelligence', college_id: 'faculty_of_science', short_name: 'DSAI', aliases: ['Data Science', 'AI'] },
  { id: 'information_technology', name: 'Information Technology', college_id: 'faculty_of_science', short_name: 'IT', aliases: ['Info Tech'] },
  { id: 'microbiology', name: 'Microbiology', college_id: 'faculty_of_science', short_name: 'MCB' },
  { id: 'biochemistry', name: 'Biochemistry', college_id: 'faculty_of_science', short_name: 'BCH' },
  { id: 'biotechnology', name: 'Biotechnology', college_id: 'faculty_of_science', short_name: 'BT' },
  { id: 'physics_industrial_physics', name: 'Physics / Industrial Physics', college_id: 'faculty_of_science', short_name: 'PHY', aliases: ['Physics', 'Industrial Physics'] },
  { id: 'chemistry_industrial_chemistry', name: 'Chemistry / Industrial Chemistry', college_id: 'faculty_of_science', short_name: 'CHM', aliases: ['Chemistry', 'Industrial Chemistry'] },
  { id: 'mathematics', name: 'Mathematics', college_id: 'faculty_of_science', short_name: 'MTH', aliases: ['Maths'] },
  { id: 'statistics', name: 'Statistics', college_id: 'faculty_of_science', short_name: 'STA' },
  { id: 'geology_applied_geophysics', name: 'Geology & Applied Geophysics', college_id: 'faculty_of_science', short_name: 'GLG', aliases: ['Geology', 'Geophysics'] },
  { id: 'plant_biology_botany', name: 'Plant Biology & Biotechnology (Botany)', college_id: 'faculty_of_science', short_name: 'BOT', aliases: ['Botany'] },
  { id: 'zoology_environmental_biology', name: 'Zoology & Environmental Biology', college_id: 'faculty_of_science', short_name: 'ZOO', aliases: ['Zoology'] },

  // Medicine & Health Sciences
  { id: 'medicine_surgery', name: 'Medicine & Surgery', college_id: 'college_of_medicine', short_name: 'MBBS', aliases: ['Medicine', 'Surgery'] },
  { id: 'nursing_science', name: 'Nursing Science', college_id: 'college_of_medicine', short_name: 'NUR', aliases: ['Nursing'] },
  { id: 'medical_laboratory_science', name: 'Medical Laboratory Science', college_id: 'college_of_medicine', short_name: 'MLS', aliases: ['Med Lab'] },
  { id: 'pharmacy', name: 'Pharmacy (PharmD / B.Pharm)', college_id: 'faculty_of_pharmacy', short_name: 'PHM', aliases: ['Pharmacy'] },
  { id: 'dentistry_dental_surgery', name: 'Dentistry & Dental Surgery', college_id: 'college_of_medicine', short_name: 'DEN', aliases: ['Dentistry'] },
  { id: 'physiotherapy', name: 'Physiotherapy & Medical Rehabilitation', college_id: 'college_of_medicine', short_name: 'PTH', aliases: ['Physiotherapy'] },
  { id: 'human_anatomy', name: 'Human Anatomy', college_id: 'college_of_medicine', short_name: 'ANA', aliases: ['Anatomy'] },
  { id: 'human_physiology', name: 'Human Physiology', college_id: 'college_of_medicine', short_name: 'PHS', aliases: ['Physiology'] },
  { id: 'public_health', name: 'Public Health', college_id: 'college_of_medicine', short_name: 'PBH' },
  { id: 'radiography', name: 'Radiography & Radiation Science', college_id: 'college_of_medicine', short_name: 'RAD' },
  { id: 'optometry', name: 'Doctor of Optometry', college_id: 'college_of_medicine', short_name: 'OPT', aliases: ['Optometry'] },

  // Law
  { id: 'commercial_property_law', name: 'Commercial & Property Law', college_id: 'faculty_of_law', short_name: 'CPL', aliases: ['Commercial Law'] },
  { id: 'public_international_law', name: 'Public & International Law', college_id: 'faculty_of_law', short_name: 'PIL', aliases: ['International Law'] },
  { id: 'jurisprudence_international_law', name: 'Jurisprudence & Legal Theory', college_id: 'faculty_of_law', short_name: 'JUR', aliases: ['Jurisprudence'] },
  { id: 'private_islamic_law', name: 'Private & Islamic Law', college_id: 'faculty_of_law', short_name: 'PILAW', aliases: ['Islamic Law'] },
  { id: 'civil_law', name: 'Civil Law & Litigation', college_id: 'faculty_of_law', short_name: 'LAW', aliases: ['Law'] },

  // Social Sciences
  { id: 'economics', name: 'Economics', college_id: 'faculty_of_social_sciences', short_name: 'ECO', aliases: ['Econ'] },
  { id: 'political_science', name: 'Political Science', college_id: 'faculty_of_social_sciences', short_name: 'POL', aliases: ['Poli Sci'] },
  { id: 'mass_communication', name: 'Mass Communication', college_id: 'faculty_of_social_sciences', short_name: 'MAC', aliases: ['Mass Comm', 'Journalism', 'Media Studies'] },
  { id: 'sociology', name: 'Sociology & Anthropology', college_id: 'faculty_of_social_sciences', short_name: 'SOC', aliases: ['Sociology'] },
  { id: 'psychology', name: 'Psychology', college_id: 'faculty_of_social_sciences', short_name: 'PSY' },
  { id: 'international_relations', name: 'International Relations & Diplomacy', college_id: 'faculty_of_social_sciences', short_name: 'IR', aliases: ['International Relations'] },
  { id: 'public_administration', name: 'Public Administration', college_id: 'faculty_of_social_sciences', short_name: 'PUB', aliases: ['Public Admin'] },
  { id: 'geography_environmental_management', name: 'Geography & Environmental Management', college_id: 'faculty_of_social_sciences', short_name: 'GEO', aliases: ['Geography'] },
  { id: 'criminology_security_studies', name: 'Criminology & Security Studies', college_id: 'faculty_of_social_sciences', short_name: 'CRM', aliases: ['Criminology'] },

  // Management Sciences
  { id: 'accounting', name: 'Accounting', college_id: 'faculty_of_management_sciences', short_name: 'ACC', aliases: ['Accountancy'] },
  { id: 'business_administration', name: 'Business Administration', college_id: 'faculty_of_management_sciences', short_name: 'BUS', aliases: ['Business Admin'] },
  { id: 'banking_finance', name: 'Banking & Finance', college_id: 'faculty_of_management_sciences', short_name: 'BFN', aliases: ['Finance'] },
  { id: 'marketing', name: 'Marketing', college_id: 'faculty_of_management_sciences', short_name: 'MKT' },
  { id: 'entrepreneurship', name: 'Entrepreneurship', college_id: 'faculty_of_management_sciences', short_name: 'ENT' },
  { id: 'human_resource_management', name: 'Human Resource Management', college_id: 'faculty_of_management_sciences', short_name: 'HRM', aliases: ['HR', 'Industrial Relations'] },
  { id: 'actuarial_science', name: 'Actuarial Science', college_id: 'faculty_of_management_sciences', short_name: 'ACT' },

  // Arts & Humanities
  { id: 'english_literary_studies', name: 'English & Literary Studies', college_id: 'faculty_of_arts', short_name: 'ENG_LIT', aliases: ['English', 'Literature'] },
  { id: 'history_international_studies', name: 'History & International Studies', college_id: 'faculty_of_arts', short_name: 'HIS', aliases: ['History'] },
  { id: 'philosophy', name: 'Philosophy', college_id: 'faculty_of_arts', short_name: 'PHL' },
  { id: 'linguistics_african_languages', name: 'Linguistics & African Languages', college_id: 'faculty_of_arts', short_name: 'LIN', aliases: ['Linguistics'] },
  { id: 'theatre_film_studies', name: 'Theatre, Film & Performing Arts', college_id: 'faculty_of_arts', short_name: 'THA', aliases: ['Theatre Arts'] },
  { id: 'religious_studies', name: 'Religious Studies', college_id: 'faculty_of_arts', short_name: 'REL' },
  { id: 'music', name: 'Music', college_id: 'faculty_of_arts', short_name: 'MUS' },

  // Environmental Sciences
  { id: 'architecture', name: 'Architecture', college_id: 'faculty_of_environmental_sciences', short_name: 'ARC' },
  { id: 'estate_management', name: 'Estate Management & Valuation', college_id: 'faculty_of_environmental_sciences', short_name: 'ESM', aliases: ['Estate Management'] },
  { id: 'quantity_surveying', name: 'Quantity Surveying', college_id: 'faculty_of_environmental_sciences', short_name: 'QS' },
  { id: 'urban_regional_planning', name: 'Urban & Regional Planning', college_id: 'faculty_of_environmental_sciences', short_name: 'URP' },
  { id: 'building_technology', name: 'Building & Construction Technology', college_id: 'faculty_of_environmental_sciences', short_name: 'BLD', aliases: ['Building'] },
  { id: 'surveying_geoinformatics', name: 'Surveying & Geoinformatics', college_id: 'faculty_of_environmental_sciences', short_name: 'SVG', aliases: ['Surveying'] },

  // Education
  { id: 'science_education', name: 'Science Education (Maths, Physics, Chemistry, Biology)', college_id: 'faculty_of_education', short_name: 'SCIED', aliases: ['Science Education'] },
  { id: 'arts_social_science_education', name: 'Arts & Social Science Education', college_id: 'faculty_of_education', short_name: 'ARTED', aliases: ['Arts Education'] },
  { id: 'educational_management', name: 'Educational Management & Administration', college_id: 'faculty_of_education', short_name: 'EDM', aliases: ['Educational Management'] },
  { id: 'guidance_counselling', name: 'Guidance & Counselling', college_id: 'faculty_of_education', short_name: 'GNC' },
  { id: 'human_kinetics_health_education', name: 'Human Kinetics & Health Education', college_id: 'faculty_of_education', short_name: 'HKE' },

  // Agriculture
  { id: 'agricultural_economics_extension', name: 'Agricultural Economics & Extension', college_id: 'faculty_of_agriculture', short_name: 'AGE', aliases: ['Agric Economics'] },
  { id: 'animal_science', name: 'Animal Science & Production', college_id: 'faculty_of_agriculture', short_name: 'ANS', aliases: ['Animal Science'] },
  { id: 'crop_soil_science', name: 'Crop & Soil Science', college_id: 'faculty_of_agriculture', short_name: 'CSS', aliases: ['Crop Science', 'Soil Science'] },
  { id: 'fisheries_aquaculture', name: 'Fisheries & Aquaculture', college_id: 'faculty_of_agriculture', short_name: 'FSH', aliases: ['Fisheries'] },
  { id: 'food_science_technology', name: 'Food Science & Technology', college_id: 'faculty_of_agriculture', short_name: 'FST', aliases: ['Food Science'] },
];

/**
 * Deduplicates and sorts any academic option list, ensuring:
 * 1. No two items share the exact same normalized root name.
 * 2. No two items share the exact same ID.
 * 3. Canonical names with proper casing are preserved.
 */
export function deduplicateAcademicList<T extends AcademicOption>(items: T[]): T[] {
  const seenNorm = new Set<string>();
  const seenId = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    if (!item || !item.name) continue;
    const norm = normalizeAcademicName(item.name);
    const id = item.id || sanitizeAcademicId(item.name);

    if (!norm || seenNorm.has(norm) || seenId.has(id)) {
      continue;
    }

    seenNorm.add(norm);
    seenId.add(id);
    result.push({
      ...item,
      id
    });
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Formats a user-entered text into a clean academic title without AI.
 */
export function formatAcademicTitle(raw: string, type: 'faculty' | 'department'): string {
  const clean = raw.trim().replace(/\s+/g, ' ');
  if (!clean) return '';

  const words = clean.split(' ').map(w => {
    const lower = w.toLowerCase();
    if (['and', 'of', 'in', '&'].includes(lower)) return lower === '&' ? '&' : lower;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  });

  const titleCased = words.join(' ');

  if (type === 'faculty') {
    if (!/^(faculty|college|school) of/i.test(titleCased)) {
      return `Faculty of ${titleCased}`;
    }
  } else if (type === 'department') {
    if (!/^(department|dept) of/i.test(titleCased)) {
      return titleCased;
    }
  }

  return titleCased;
}
