import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://eywpksapztzbnthlgfhd.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Set SUPABASE_SERVICE_ROLE_KEY before running this script.');
}

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function linkHierarchy() {
  const { data: colleges } = await adminClient.from('colleges').select('*');
  console.log('Colleges in DB:', colleges);

  const { data: departments } = await adminClient.from('departments').select('*');
  console.log('\nDepartments in DB:', departments);

  // Link engineering departments to college_of_engineering
  for (const dept of (departments || [])) {
    let collegeId = null;
    if (dept.id.includes('engineering') || dept.id.includes('natural_gas') || dept.id.includes('petro')) {
      collegeId = 'college_of_engineering';
    } else if (dept.id.includes('science') || dept.id.includes('math') || dept.id.includes('computer_science')) {
      collegeId = 'college_of_science';
    }

    if (collegeId) {
      await adminClient.from('departments').update({ college_id: collegeId, school_id: 'fupre' }).eq('id', dept.id);
    }
  }

  // Ensure colleges have school_id = 'fupre'
  await adminClient.from('colleges').update({ school_id: 'fupre' }).neq('id', '');

  console.log('\nUpdated hierarchy links. Testing nested query again:');
  const { data: tree } = await adminClient
    .from('schools')
    .select(`
      id,
      name,
      colleges (
        id,
        name,
        departments (
          id,
          name,
          courses (
            id,
            code,
            title,
            level,
            semester
          )
        )
      )
    `)
    .eq('id', 'fupre');

  console.log(JSON.stringify(tree, null, 2));
}

linkHierarchy();
