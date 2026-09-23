/**
 * Source data for the demo seed.
 *
 * Names are drawn from the communities actually represented in Mehdipatnam,
 * Hyderabad — Telugu, Hindi/Urdu-speaking Muslim, Marathi and Tamil families —
 * rather than generic placeholder names. A demo that looks like the real
 * member list is far more useful for judging whether the UI works: it surfaces
 * long names, short names, and names that break naive column widths.
 */

export const MALE_FIRST_NAMES = [
  'Aarav', 'Abdul', 'Adnan', 'Ajay', 'Akash', 'Akhil', 'Ali', 'Aman',
  'Anand', 'Aniket', 'Anil', 'Arjun', 'Arun', 'Asif', 'Balaji', 'Bharath',
  'Chaitanya', 'Charan', 'Deepak', 'Dinesh', 'Faisal', 'Farhan', 'Ganesh',
  'Gopal', 'Harish', 'Hemanth', 'Imran', 'Irfan', 'Jagdish', 'Javed',
  'Kalyan', 'Karthik', 'Kiran', 'Krishna', 'Lokesh', 'Madhav', 'Mahesh',
  'Manoj', 'Mohammed', 'Mohan', 'Mukesh', 'Naveen', 'Nikhil', 'Nitin',
  'Pavan', 'Prakash', 'Pranav', 'Praveen', 'Raghu', 'Rahul', 'Rajesh',
  'Rakesh', 'Ramesh', 'Ravi', 'Rohit', 'Sagar', 'Sai', 'Salman', 'Sameer',
  'Sandeep', 'Santosh', 'Saqib', 'Sathish', 'Shiva', 'Srikanth', 'Sudhir',
  'Sunil', 'Suresh', 'Tarun', 'Uday', 'Varun', 'Vamsi', 'Venkatesh',
  'Vijay', 'Vikram', 'Vinay', 'Vishal', 'Yaseen', 'Yash', 'Zubair',
] as const;

export const FEMALE_FIRST_NAMES = [
  'Aaliya', 'Aditi', 'Afreen', 'Aisha', 'Akshara', 'Ambika', 'Anitha',
  'Anjali', 'Anusha', 'Aruna', 'Asma', 'Bhavani', 'Chandana', 'Deepika',
  'Divya', 'Fatima', 'Gayathri', 'Harini', 'Hasina', 'Indira', 'Jyothi',
  'Kavitha', 'Keerthi', 'Lakshmi', 'Latha', 'Madhuri', 'Manasa', 'Meena',
  'Nafisa', 'Nandini', 'Navya', 'Neha', 'Nikitha', 'Padma', 'Pooja',
  'Prathima', 'Priya', 'Radha', 'Rajitha', 'Ramya', 'Rani', 'Rashmi',
  'Rekha', 'Renuka', 'Rubina', 'Sadia', 'Sandhya', 'Sangeetha', 'Sanjana',
  'Saraswathi', 'Shabana', 'Shalini', 'Sharmila', 'Shilpa', 'Shobha',
  'Sirisha', 'Sneha', 'Srilatha', 'Sudha', 'Sunitha', 'Swapna', 'Swathi',
  'Tabassum', 'Usha', 'Vandana', 'Vasundhara', 'Vidya', 'Yamini', 'Zainab',
] as const;

export const SURNAMES = [
  'Reddy', 'Rao', 'Naidu', 'Sharma', 'Verma', 'Gupta', 'Kumar', 'Chowdary',
  'Goud', 'Yadav', 'Shetty', 'Pillai', 'Nair', 'Menon', 'Iyer', 'Krishnan',
  'Patel', 'Shah', 'Mehta', 'Joshi', 'Desai', 'Kulkarni', 'Deshmukh',
  'Jadhav', 'Patil', 'Khan', 'Ahmed', 'Syed', 'Hussain', 'Siddiqui',
  'Ansari', 'Qureshi', 'Sheikh', 'Pathan', 'Mirza', 'Baig', 'Rahman',
  'Prasad', 'Varma', 'Murthy', 'Acharya', 'Bhat', 'Hegde', 'Kamath',
  'Rathod', 'Chauhan', 'Singh', 'Thakur', 'Malhotra', 'Kapoor',
] as const;

/** Localities around Mehdipatnam that a real member list would show. */
export const HYDERABAD_LOCALITIES = [
  { area: 'Mehdipatnam', pincode: '500028' },
  { area: 'Asif Nagar', pincode: '500028' },
  { area: 'Humayun Nagar', pincode: '500028' },
  { area: 'Masab Tank', pincode: '500028' },
  { area: 'Banjara Hills', pincode: '500034' },
  { area: 'Tolichowki', pincode: '500008' },
  { area: 'Attapur', pincode: '500048' },
  { area: 'Rajendranagar', pincode: '500030' },
  { area: 'Langar Houz', pincode: '500008' },
  { area: 'Golconda', pincode: '500008' },
  { area: 'Shaikpet', pincode: '500008' },
  { area: 'Gudimalkapur', pincode: '500028' },
  { area: 'Vijay Nagar Colony', pincode: '500057' },
  { area: 'Red Hills', pincode: '500004' },
  { area: 'Lakdikapul', pincode: '500004' },
  { area: 'Nampally', pincode: '500001' },
  { area: 'Malakpet', pincode: '500036' },
  { area: 'Santosh Nagar', pincode: '500059' },
  { area: 'Chandrayangutta', pincode: '500005' },
  { area: 'Bahadurpura', pincode: '500064' },
] as const;

export const STREET_NAMES = [
  'Main Road', 'Road No. 1', 'Road No. 3', 'Road No. 12', 'Cross Road',
  'Street No. 8', 'Old Post Office Road', 'Masjid Road', 'Temple Street',
  'Market Road', 'Station Road', 'Park Lane', 'School Road', 'Hill Street',
] as const;

export const EMERGENCY_RELATIONS = [
  'Father', 'Mother', 'Spouse', 'Brother', 'Sister', 'Son', 'Daughter',
  'Friend', 'Uncle', 'Cousin',
] as const;

/**
 * Membership plans.
 *
 * Placeholder pricing for the Mehdipatnam market, as agreed — realistic for a
 * neighbourhood gym in this part of Hyderabad, and editable from the UI once
 * the real figures are known. Prices are in PAISE.
 */
export const SEED_PLANS = [
  {
    name: 'Monthly',
    description: 'Full gym access, billed month to month.',
    type: 'MONTHLY' as const,
    durationDays: 30,
    pricePaise: 150_000,
    joiningFeePaise: 50_000,
    maxFreezeDays: 0,
    features: ['Full gym access', 'Locker facility', 'Fitness assessment'],
    sortOrder: 1,
  },
  {
    name: 'Quarterly',
    description: 'Three months, at a better rate than monthly.',
    type: 'QUARTERLY' as const,
    durationDays: 90,
    pricePaise: 400_000,
    joiningFeePaise: 50_000,
    maxFreezeDays: 7,
    features: [
      'Full gym access',
      'Locker facility',
      'Fitness assessment',
      '7 freeze days',
      'Diet consultation',
    ],
    sortOrder: 2,
  },
  {
    name: 'Half-Yearly',
    description: 'Six months, with a personal-training session included.',
    type: 'HALF_YEARLY' as const,
    durationDays: 180,
    pricePaise: 700_000,
    joiningFeePaise: 0,
    maxFreezeDays: 15,
    features: [
      'Full gym access',
      'Locker facility',
      'Monthly assessment',
      '15 freeze days',
      'Diet plan',
      '1 PT session / month',
    ],
    sortOrder: 3,
  },
  {
    name: 'Yearly',
    description: 'Best value. Twelve months with full benefits.',
    type: 'YEARLY' as const,
    durationDays: 365,
    pricePaise: 1_200_000,
    joiningFeePaise: 0,
    maxFreezeDays: 30,
    features: [
      'Full gym access',
      'Premium locker',
      'Monthly assessment',
      '30 freeze days',
      'Personalised diet plan',
      '2 PT sessions / month',
      'Guest passes',
    ],
    sortOrder: 4,
  },
  {
    name: 'Student Monthly',
    description: 'Discounted monthly rate. Valid student ID required.',
    type: 'MONTHLY' as const,
    durationDays: 30,
    pricePaise: 100_000,
    joiningFeePaise: 30_000,
    maxFreezeDays: 0,
    features: ['Full gym access', 'Locker facility', 'Off-peak hours'],
    sortOrder: 5,
  },
  {
    name: 'Couple Quarterly',
    description: 'Three months for two members, sharing one plan.',
    type: 'QUARTERLY' as const,
    durationDays: 90,
    pricePaise: 700_000,
    joiningFeePaise: 50_000,
    maxFreezeDays: 7,
    features: [
      'Full gym access for two',
      'Locker facility',
      'Joint fitness assessment',
      '7 freeze days',
    ],
    sortOrder: 6,
  },
] as const;

export const TRAINER_SPECIALIZATIONS = [
  ['Strength Training', 'Powerlifting'],
  ['Weight Loss', 'HIIT', 'Cardio'],
  ['Bodybuilding', 'Nutrition'],
  ['Functional Fitness', 'CrossFit'],
  ['Yoga', 'Flexibility', 'Rehabilitation'],
  ['Sports Conditioning', 'Endurance'],
] as const;

export const CERTIFICATIONS = [
  'ACE Certified Personal Trainer',
  'ISSA Certified Fitness Trainer',
  'K11 Certified Fitness Trainer',
  'NASM-CPT',
  'Diploma in Fitness Training',
  'Certified Nutrition Coach',
  'Yoga Alliance RYT-200',
] as const;
