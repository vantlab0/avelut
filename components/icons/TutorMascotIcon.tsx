import React from 'react';

export const TutorMascotIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
  >
    <circle cx="12" cy="11" r="7.25" fill="currentColor" opacity="0.12" stroke="currentColor" strokeWidth="1.8" />
    <path
      d="M7.5 17.2C8.7 18.95 10.24 19.75 12 19.75C13.76 19.75 15.3 18.95 16.5 17.2"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <path
      d="M9.1 10.1C9.1 9.52 9.57 9.05 10.15 9.05C10.73 9.05 11.2 9.52 11.2 10.1C11.2 10.68 10.73 11.15 10.15 11.15C9.57 11.15 9.1 10.68 9.1 10.1Z"
      fill="currentColor"
    />
    <path
      d="M12.8 10.1C12.8 9.52 13.27 9.05 13.85 9.05C14.43 9.05 14.9 9.52 14.9 10.1C14.9 10.68 14.43 11.15 13.85 11.15C13.27 11.15 12.8 10.68 12.8 10.1Z"
      fill="currentColor"
    />
    <path
      d="M10.2 13.1C10.75 13.62 11.34 13.88 12 13.88C12.66 13.88 13.25 13.62 13.8 13.1"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <path
      d="M8.2 4.7L6.9 2.9M15.8 4.7L17.1 2.9"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <path
      d="M4.5 10.6H2.9M21.1 10.6H19.5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);
