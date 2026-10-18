import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabaseDataService } from '../services/supabaseDataService';
import { HARDCODED_UNIVERSITY_OPTIONS } from '../constants/universities';
import { useAppSettings } from '../hooks/useAppSettings';
import { createAvelutAI, getResponseText } from '../utils/inference';

const sanitizeId = (name: string) => 
  name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

interface Option {
  id: string;
  name: string;
  short_name?: string;
}

interface CustomSearchableSelectProps {
  label: string;
  stepNumber: number;
  options: Option[];
  value: string;
  onChange: (opt: Option) => void;
  placeholder: string;
  disabled?: boolean;
  onAddNew?: (name: string) => Promise<void>;
  emptyText?: string;
}

const CustomSearchableSelect: React.FC<CustomSearchableSelectProps> = ({ 
  label, stepNumber, options, value, onChange, placeholder, disabled, onAddNew, emptyText = "No matching options found."
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
      (opt.short_name && opt.short_name.toLowerCase().includes(q))
    );
  }, [options, query, selectedOption]);

  const handleSelect = (opt: Option) => {
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
    if (onAddNew && query.trim()) {
      setIsAddingNew(true);
      try {
        await onAddNew(query.trim());
        setIsOpen(false);
      } finally {
        setIsAddingNew(false);
      }
    } else if (query.trim()) {
      // Free-text fallback if no onAddNew handler supplied
      const freeTextOpt: Option = {
        id: sanitizeId(query.trim()),
        name: query.trim()
      };
      handleSelect(freeTextOpt);
    }
  };

  const showAddNew = Boolean(
    query.trim() &&
    !filteredOptions.some(opt => opt.name.toLowerCase() === query.trim().toLowerCase()) &&
    (onAddNew || !options.length)
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

interface SchoolHierarchySelectorProps {
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
  const [colleges, setColleges] = useState<Array<{ id: string; name: string; school_id?: string }>>([]);
  const [departments, setDepartments] = useState<Array<{ id: string; name: string; college_id?: string }>>([]);
  const { settings: appSettings } = useAppSettings();

  // 1. Fetch live custom/stored schools from Supabase
  useEffect(() => {
    let isMounted = true;
    void supabaseDataService.fetchSchools().then(res => {
      if (isMounted && res.length > 0) {
        setDbSchools(res);
      }
    });
    return () => { isMounted = false; };
  }, []);

  // Combined schools list: Hardcoded NUC List + Supabase DB entries
  const schoolOptions = useMemo(() => {
    const map = new Map<string, Option>();
    // Pre-populate with hardcoded list
    HARDCODED_UNIVERSITY_OPTIONS.forEach(opt => {
      map.set(opt.id, opt);
    });
    // Add any DB schools that might not be in hardcoded list
    dbSchools.forEach(s => {
      if (!map.has(s.id)) {
        map.set(s.id, { id: s.id, name: s.name, short_name: s.short_name });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [dbSchools]);

  // 2. Fetch live colleges when schoolId changes
  useEffect(() => {
    let isMounted = true;
    if (schoolId) {
      void supabaseDataService.fetchColleges(schoolId).then(res => {
        if (isMounted) setColleges(res);
      });
    } else {
      setColleges([]);
    }
    return () => { isMounted = false; };
  }, [schoolId]);

  // 3. Fetch live departments when collegeId or schoolId changes
  useEffect(() => {
    let isMounted = true;
    if (schoolId) {
      void supabaseDataService.fetchDepartments(schoolId, collegeId || undefined).then(res => {
        if (isMounted) setDepartments(res);
      });
    } else {
      setDepartments([]);
    }
    return () => { isMounted = false; };
  }, [schoolId, collegeId]);

  // Smart AI Duplicate Prevention for Faculties & Departments
  const deduplicateAndStandardize = async (
    inputName: string, 
    type: 'College/Faculty' | 'Department', 
    existingList: Option[]
  ): Promise<{ id: string; name: string; isDuplicate: boolean }> => {
    const cleanInput = inputName.trim().toLowerCase().replace(/\s+/g, ' ');
    const strippedInput = cleanInput
      .replace(/^(faculty of|college of|school of|department of)\s+/i, '')
      .trim();
    
    for (const item of existingList) {
      const itemName = item.name.toLowerCase().replace(/\s+/g, ' ');
      const strippedItemName = itemName
        .replace(/^(faculty of|college of|school of|department of)\s+/i, '')
        .trim();

      if (
        itemName === cleanInput ||
        strippedItemName === strippedInput ||
        strippedItemName.includes(strippedInput) ||
        strippedInput.includes(strippedItemName)
      ) {
        return { id: item.id, name: item.name, isDuplicate: true };
      }
    }

    const school = schoolOptions.find(s => s.id === schoolId);
    const schoolName = school?.name || 'the university';

    try {
      const ai = createAvelutAI(appSettings, null);
      if (!ai) {
        const fallbackName = type === 'College/Faculty' && !inputName.toLowerCase().startsWith('faculty') 
          ? `Faculty of ${inputName}` 
          : inputName;
        return { id: sanitizeId(fallbackName), name: fallbackName, isDuplicate: false };
      }

      const existingNamesStr = existingList.map(e => `"${e.name}" (id: "${e.id}")`).join(', ');
      const prompt = `You are an academic database deduplication engine for ${schoolName}.
Existing ${type}s: [${existingNamesStr}].
User entered: "${inputName}".
Task:
1. Check if "${inputName}" is a duplicate, synonym, or abbreviation of any existing item in the list above (e.g. "CS" or "Comp Sci" vs "Computer Science", "Pet Eng" vs "Petroleum Engineering").
2. If it is a duplicate, return: {"isDuplicate": true, "matchedId": "<existing_id>", "canonicalName": "<existing_name>"}
3. If it is genuinely a new ${type}, standardize its name (e.g. "Faculty of Engineering", "Department of Chemical Engineering") and return: {"isDuplicate": false, "canonicalName": "<Standardized Name>"}
Return ONLY valid JSON.`;

      const response = await ai.models.generateContent({
        model: 'qwen/qwen3.7-flash',
        contents: prompt,
        config: { maxOutputTokens: 250 }
      });

      const rawJson = getResponseText(response).replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(rawJson);

      if (parsed.isDuplicate && parsed.matchedId) {
        return { id: parsed.matchedId, name: parsed.canonicalName, isDuplicate: true };
      }

      const canonicalName = parsed.canonicalName || inputName;
      return { id: sanitizeId(canonicalName), name: canonicalName, isDuplicate: false };
    } catch (err) {
      console.warn('[SchoolSelector] Deduplication AI fallback:', err);
      const fallbackName = type === 'College/Faculty' && !inputName.toLowerCase().startsWith('faculty') && !inputName.toLowerCase().startsWith('college')
        ? `Faculty of ${inputName}` 
        : inputName;
      return { id: sanitizeId(fallbackName), name: fallbackName, isDuplicate: false };
    }
  };

  const handleAddCollege = async (name: string) => {
    if (!schoolId) return;
    const res = await deduplicateAndStandardize(name, 'College/Faculty', collegesOptions);
    if (!res.isDuplicate) {
      await supabaseDataService.upsertCollege({ id: res.id, name: res.name, school_id: schoolId });
      setColleges(prev => [...prev, { id: res.id, name: res.name, school_id: schoolId }]);
    }
    setCollegeId(res.id);
  };

  const handleAddDepartment = async (name: string) => {
    if (!schoolId) return;
    const res = await deduplicateAndStandardize(name, 'Department', departmentOptions);
    if (!res.isDuplicate) {
      await supabaseDataService.upsertDepartment({
        id: res.id,
        name: res.name,
        school_id: schoolId,
        college_id: collegeId || undefined
      });
      setDepartments(prev => [...prev, { id: res.id, name: res.name, college_id: collegeId }]);
    }
    setDepartmentId(res.id);
  };
  
  const collegesOptions = useMemo(() => {
    return colleges.map(c => ({ id: c.id, name: c.name }));
  }, [colleges]);

  const departmentOptions = useMemo(() => {
    return departments.map(d => ({ id: d.id, name: d.name }));
  }, [departments]);

  const handleOptionSelected = async (level: 'school'|'college'|'department', opt: Option) => {
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
        const isLocal = colleges.some(c => c.id === id);
        if (!isLocal) {
          await supabaseDataService.upsertCollege({ id, name, school_id: schoolId });
          setColleges(prev => [...prev, { id, name, school_id: schoolId }]);
        }
      }
    } else if (level === 'department') {
      setDepartmentId(id);
      if (schoolId) {
        const isLocal = departments.some(d => d.id === id);
        if (!isLocal) {
          await supabaseDataService.upsertDepartment({ id, name, school_id: schoolId, college_id: collegeId });
          setDepartments(prev => [...prev, { id, name, college_id: collegeId }]);
        }
      }
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-left">
      <CustomSearchableSelect 
        stepNumber={1}
        label="University / Institution"
        options={schoolOptions}
        value={schoolId}
        onChange={(opt) => handleOptionSelected('school', opt)}
        placeholder="Select or search university..."
        disabled={disabled}
        emptyText="No university found"
      />

      <CustomSearchableSelect 
        stepNumber={2}
        label="Faculty / College"
        options={collegesOptions}
        value={collegeId}
        onChange={(opt) => handleOptionSelected('college', opt)}
        placeholder="Select faculty..."
        disabled={disabled || !schoolId}
        onAddNew={handleAddCollege}
      />

      <CustomSearchableSelect 
        stepNumber={3}
        label="Department"
        options={departmentOptions}
        value={departmentId}
        onChange={(opt) => handleOptionSelected('department', opt)}
        placeholder="Select department..."
        disabled={disabled || !collegeId}
        onAddNew={handleAddDepartment}
      />
    </div>
  );
};
