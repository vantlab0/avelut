import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabaseDataService } from '../services/supabaseDataService';
import { HARDCODED_UNIVERSITY_OPTIONS } from '../constants/universities';
import {
  AcademicOption,
  STANDARD_FACULTIES,
  STANDARD_DEPARTMENTS,
  deduplicateAcademicList,
  normalizeAcademicName,
  sanitizeAcademicId,
  formatAcademicTitle
} from '../constants/academicHierarchy';

interface CustomSearchableSelectProps {
  label: string;
  stepNumber: number;
  options: AcademicOption[];
  value: string;
  onChange: (opt: AcademicOption) => void;
  placeholder: string;
  disabled?: boolean;
  allowAddNew?: boolean;
  onAddNew?: (name: string) => Promise<void>;
  emptyText?: string;
}

const CustomSearchableSelect: React.FC<CustomSearchableSelectProps> = ({ 
  label,
  stepNumber,
  options,
  value,
  onChange,
  placeholder,
  disabled,
  allowAddNew = false,
  onAddNew,
  emptyText = "No matching options found."
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [isAddingNew, setIsAddingNew] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = useMemo(() => {
    return options.find(opt => opt.id === value) || (value ? { id: value, name: value.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') } : null);
  }, [options, value]);

  // Synchronize input text with value/selection when dropdown is closed
  useEffect(() => {
    if (!isOpen) {
      if (selectedOption) {
        setQuery(selectedOption.name);
      } else {
        setQuery('');
      }
    }
  }, [value, selectedOption, isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = useMemo(() => {
    if (!query.trim() || (selectedOption && query.trim() === selectedOption.name.trim())) {
      return options;
    }
    const q = query.toLowerCase().trim();
    return options.filter(opt =>
      opt.name.toLowerCase().includes(q) ||
      (opt.short_name && opt.short_name.toLowerCase().includes(q)) ||
      (opt.aliases && opt.aliases.some(alias => alias.toLowerCase().includes(q)))
    );
  }, [options, query, selectedOption]);

  const handleSelect = (opt: AcademicOption) => {
    onChange(opt);
    setQuery(opt.name);
    setIsOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    setQuery(newQuery);
    if (!isOpen) setIsOpen(true);
  };

  const handleInputFocus = () => {
    if (!disabled) {
      setIsOpen(true);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange({ id: '', name: '' });
    setQuery('');
    setIsOpen(true);
    if (inputRef.current) inputRef.current.focus();
  };

  const handleAddNew = async () => {
    if (!allowAddNew || !query.trim()) return;

    if (onAddNew) {
      setIsAddingNew(true);
      try {
        await onAddNew(query.trim());
        setIsOpen(false);
      } finally {
        setIsAddingNew(false);
      }
    } else {
      const freeTextOpt: AcademicOption = {
        id: sanitizeAcademicId(query.trim()),
        name: query.trim()
      };
      handleSelect(freeTextOpt);
    }
  };

  const showAddNew = Boolean(
    allowAddNew &&
    query.trim() &&
    !filteredOptions.some(opt => normalizeAcademicName(opt.name) === normalizeAcademicName(query.trim()))
  );

  return (
    <div className="relative" ref={dropdownRef}>
      <label className="flex items-center gap-2 text-sm font-bold text-[#0F172A] dark:text-white mb-2">
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#0066FF] text-white text-xs font-black">
          {stepNumber}
        </span>
        {label}
      </label>

      {/* Inline Search Trigger */}
      <div 
        className={`w-full bg-[#F1F5F9]/80 dark:bg-white/5 border border-[#E3E9F1] dark:border-white/10 rounded-2xl py-3 px-4 flex items-center justify-between text-[#0F172A] dark:text-white transition-all duration-200 focus-within:ring-2 focus-within:ring-[#0066FF] hover:border-[#0066FF]/50 ${disabled ? 'opacity-50 cursor-not-allowed bg-gray-100 dark:bg-white/5' : ''}`}
      >
        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          className="w-full bg-transparent border-none focus:outline-none text-sm text-[#0F172A] dark:text-white placeholder-[#64748B] font-medium pr-2"
          placeholder={placeholder}
          value={query}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
        />

        <div className="flex items-center gap-1 shrink-0 text-[#64748B]">
          {query && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1 hover:text-[#0F172A] dark:hover:text-white transition-colors"
              title="Clear selection"
            >
              <i className="bi bi-x-circle-fill text-sm"></i>
            </button>
          )}
          <i
            className={`bi bi-chevron-${isOpen ? 'up' : 'down'} text-xs cursor-pointer transition-transform`}
            onClick={() => !disabled && setIsOpen(!isOpen)}
          ></i>
        </div>
      </div>

      {isOpen && !disabled && (
        <div className="absolute z-30 w-full mt-2 bg-white dark:bg-[#0A0A0A] border border-[#E3E9F1] dark:border-white/10 rounded-2xl shadow-2xl max-h-72 flex flex-col overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="overflow-y-auto p-1.5 flex-1 space-y-1">
            {filteredOptions.length === 0 && !showAddNew ? (
              <div className="p-4 text-sm text-[#64748B] dark:text-gray-400 text-center">
                {emptyText}
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = value === opt.id;
                return (
                  <div
                    key={opt.id}
                    className={`p-3 text-sm rounded-xl cursor-pointer flex items-center justify-between transition-colors ${
                      isSelected 
                        ? 'bg-[#0066FF]/10 text-[#0066FF] dark:text-[#38BDF8] font-bold border border-[#0066FF]/20' 
                        : 'hover:bg-[#F1F5F9] dark:hover:bg-white/5 text-[#0F172A] dark:text-gray-200'
                    }`}
                    onClick={() => handleSelect(opt)}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <span className="line-clamp-1 font-medium">{opt.name}</span>
                      {opt.short_name && opt.short_name !== opt.name && (
                        <span className="text-[11px] text-[#64748B] dark:text-gray-400 uppercase tracking-wide">
                          {opt.short_name}
                        </span>
                      )}
                    </div>
                    {isSelected && <i className="bi bi-check-circle-fill text-[#0066FF] shrink-0 text-base"></i>}
                  </div>
                );
              })
            )}
            
            {showAddNew && (
              <div
                className={`p-3 text-sm rounded-xl flex items-center justify-center gap-2 bg-[#0066FF]/10 text-[#0066FF] dark:text-[#38BDF8] border border-dashed border-[#0066FF]/40 font-bold transition-all ${
                  isAddingNew ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer hover:bg-[#0066FF]/20'
                }`}
                onClick={!isAddingNew ? handleAddNew : undefined}
              >
                {isAddingNew ? (
                  <>
                    <i className="bi bi-arrow-repeat animate-spin"></i>
                    <span>Adding "{query}"...</span>
                  </>
                ) : (
                  <>
                    <i className="bi bi-plus-circle-fill"></i>
                    <span className="line-clamp-1">Use/Add "{query}"</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export interface SchoolHierarchySelectorProps {
  schoolId: string;
  setSchoolId: (val: string) => void;
  collegeId: string;
  setCollegeId: (val: string) => void;
  departmentId: string;
  setDepartmentId: (val: string) => void;
  disabled?: boolean;
}

export const SchoolHierarchySelector: React.FC<SchoolHierarchySelectorProps> = ({
  schoolId, setSchoolId, collegeId, setCollegeId, departmentId, setDepartmentId, disabled
}) => {
  const [dbSchools, setDbSchools] = useState<Array<{ id: string; name: string; short_name?: string }>>([]);
  const [dbColleges, setDbColleges] = useState<Array<{ id: string; name: string; school_id?: string }>>([]);
  const [dbDepartments, setDbDepartments] = useState<Array<{ id: string; name: string; college_id?: string; school_id?: string }>>([]);

  // 1. Fetch live stored schools from Supabase
  useEffect(() => {
    let isMounted = true;
    void supabaseDataService.fetchSchools().then(res => {
      if (isMounted && res.length > 0) {
        setDbSchools(res);
      }
    });
    return () => { isMounted = false; };
  }, []);

  // Combined schools list: Hardcoded universities + Supabase DB schools (strictly deduplicated, zero AI)
  const schoolOptions = useMemo(() => {
    const combined: AcademicOption[] = [
      ...HARDCODED_UNIVERSITY_OPTIONS,
      ...dbSchools.map(s => ({ id: s.id, name: s.name, short_name: s.short_name }))
    ];
    return deduplicateAcademicList(combined);
  }, [dbSchools]);

  // 2. Fetch live colleges when schoolId changes
  useEffect(() => {
    let isMounted = true;
    if (schoolId) {
      void supabaseDataService.fetchColleges(schoolId).then(res => {
        if (isMounted) setDbColleges(res);
      });
    } else {
      setDbColleges([]);
    }
    return () => { isMounted = false; };
  }, [schoolId]);

  // Combined colleges list: Standard faculties + Supabase DB colleges (strictly deduplicated, zero AI)
  const collegesOptions = useMemo(() => {
    const combined: AcademicOption[] = [
      ...STANDARD_FACULTIES,
      ...dbColleges.map(c => ({ id: c.id, name: c.name }))
    ];
    return deduplicateAcademicList(combined);
  }, [dbColleges]);

  // 3. Fetch live departments when collegeId or schoolId changes
  useEffect(() => {
    let isMounted = true;
    if (schoolId) {
      void supabaseDataService.fetchDepartments(schoolId, collegeId || undefined).then(res => {
        if (isMounted) setDbDepartments(res);
      });
    } else {
      setDbDepartments([]);
    }
    return () => { isMounted = false; };
  }, [schoolId, collegeId]);

  // Combined departments list: Standard departments + Supabase DB departments (strictly deduplicated, zero AI)
  const departmentOptions = useMemo(() => {
    let baseList = STANDARD_DEPARTMENTS;

    // When a college/faculty is selected, prioritize or filter matching departments
    if (collegeId) {
      const selectedCollege = collegesOptions.find(c => c.id === collegeId);
      const normCollege = selectedCollege ? normalizeAcademicName(selectedCollege.name) : '';

      const facultyDepts = STANDARD_DEPARTMENTS.filter(d => {
        if (d.college_id === collegeId) return true;
        if (d.college_id) {
          const stdFac = STANDARD_FACULTIES.find(f => f.id === d.college_id);
          if (stdFac && normalizeAcademicName(stdFac.name) === normCollege) return true;
        }
        return false;
      });

      if (facultyDepts.length > 0) {
        baseList = facultyDepts;
      }
    }

    const combined: AcademicOption[] = [
      ...baseList,
      ...dbDepartments.map(d => ({ id: d.id, name: d.name, college_id: d.college_id }))
    ];

    return deduplicateAcademicList(combined);
  }, [collegeId, collegesOptions, dbDepartments]);

  const handleAddCollege = async (rawName: string) => {
    if (!schoolId || !rawName.trim()) return;
    const formattedName = formatAcademicTitle(rawName, 'faculty');
    const norm = normalizeAcademicName(formattedName);

    // If duplicate already exists, select it directly
    const existing = collegesOptions.find(c => normalizeAcademicName(c.name) === norm);
    if (existing) {
      setCollegeId(existing.id);
      return;
    }

    const newId = sanitizeAcademicId(formattedName);
    await supabaseDataService.upsertCollege({ id: newId, name: formattedName, school_id: schoolId });
    setDbColleges(prev => [...prev, { id: newId, name: formattedName, school_id: schoolId }]);
    setCollegeId(newId);
  };

  const handleAddDepartment = async (rawName: string) => {
    if (!schoolId || !rawName.trim()) return;
    const formattedName = formatAcademicTitle(rawName, 'department');
    const norm = normalizeAcademicName(formattedName);

    // If duplicate already exists, select it directly
    const existing = departmentOptions.find(d => normalizeAcademicName(d.name) === norm);
    if (existing) {
      setDepartmentId(existing.id);
      return;
    }

    const newId = sanitizeAcademicId(formattedName);
    await supabaseDataService.upsertDepartment({
      id: newId,
      name: formattedName,
      school_id: schoolId,
      college_id: collegeId || undefined
    });
    setDbDepartments(prev => [...prev, { id: newId, name: formattedName, college_id: collegeId, school_id: schoolId }]);
    setDepartmentId(newId);
  };

  const handleOptionSelected = async (level: 'school'|'college'|'department', opt: AcademicOption) => {
    const id = opt.id;
    const name = opt.name;

    if (level === 'school') {
      setSchoolId(id);
      const isLocal = dbSchools.some(s => s.id === id);
      if (!isLocal) {
        await supabaseDataService.upsertSchool({ id, name, short_name: opt.short_name });
        setDbSchools(prev => [...prev, { id, name, short_name: opt.short_name }]);
      }
    } else if (level === 'college') {
      setCollegeId(id);
      if (schoolId) {
        const isLocal = dbColleges.some(c => c.id === id);
        if (!isLocal) {
          await supabaseDataService.upsertCollege({ id, name, school_id: schoolId });
          setDbColleges(prev => [...prev, { id, name, school_id: schoolId }]);
        }
      }
    } else if (level === 'department') {
      setDepartmentId(id);
      if (schoolId) {
        const isLocal = dbDepartments.some(d => d.id === id);
        if (!isLocal) {
          await supabaseDataService.upsertDepartment({ id, name, school_id: schoolId, college_id: collegeId });
          setDbDepartments(prev => [...prev, { id, name, college_id: collegeId, school_id: schoolId }]);
        }
      }
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-left">
      {/* 1. School Selector: strictly hardcoded/available list, no AI, no duplicate additions */}
      <CustomSearchableSelect 
        stepNumber={1}
        label="University / Institution"
        options={schoolOptions}
        value={schoolId}
        onChange={(opt) => handleOptionSelected('school', opt)}
        placeholder="Type to search university..."
        disabled={disabled}
        allowAddNew={false}
        emptyText="No university found. Please choose from available universities."
      />

      {/* 2. College / Faculty Selector: standard faculties list + inline search */}
      <CustomSearchableSelect 
        stepNumber={2}
        label="Faculty / College"
        options={collegesOptions}
        value={collegeId}
        onChange={(opt) => handleOptionSelected('college', opt)}
        placeholder="Select or search faculty..."
        disabled={disabled || !schoolId}
        allowAddNew={true}
        onAddNew={handleAddCollege}
        emptyText="No faculty found."
      />

      {/* 3. Department Selector: standard departments list + inline search */}
      <CustomSearchableSelect 
        stepNumber={3}
        label="Department"
        options={departmentOptions}
        value={departmentId}
        onChange={(opt) => handleOptionSelected('department', opt)}
        placeholder="Select or search department..."
        disabled={disabled || !collegeId}
        allowAddNew={true}
        onAddNew={handleAddDepartment}
        emptyText="No department found."
      />
    </div>
  );
};
