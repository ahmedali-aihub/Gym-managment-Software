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
 * Membership plans — the gym's real price list (the card at the desk):
 * 1, 2, 3, 4, 6 and 12 months at ₹2,000 / 3,000 / 4,500 / 5,500 / 7,500 /
 * 14,000. No joining fee. Prices are in PAISE.
 */
export const SEED_PLANS = [
  {
    name: 'FITNESS 1M',
    description: '1 month of gym access. One day cardio, one day weight training.',
    type: 'MONTHLY' as const,
    durationDays: 30,
    pricePaise: 200_000,
    joiningFeePaise: 0,
    maxFreezeDays: 0,
    features: [] as string[],
    sortOrder: 1,
  },
  {
    name: 'FITNESS 2M',
    description: '2 months of gym access. One day cardio, one day weight training.',
    type: 'CUSTOM' as const,
    durationDays: 60,
    pricePaise: 300_000,
    joiningFeePaise: 0,
    maxFreezeDays: 0,
    features: [] as string[],
    sortOrder: 2,
  },
  {
    name: 'FITNESS 3M',
    description: '3 months of gym access. One day cardio, one day weight training.',
    type: 'QUARTERLY' as const,
    durationDays: 90,
    pricePaise: 450_000,
    joiningFeePaise: 0,
    maxFreezeDays: 0,
    features: [] as string[],
    sortOrder: 3,
  },
  {
    name: 'FITNESS 4M',
    description: '4 months of gym access. One day cardio, one day weight training.',
    type: 'CUSTOM' as const,
    durationDays: 120,
    pricePaise: 550_000,
    joiningFeePaise: 0,
    maxFreezeDays: 0,
    features: [] as string[],
    sortOrder: 4,
  },
  {
    name: 'FITNESS 6M',
    description: '6 months of gym access. One day cardio, one day weight training.',
    type: 'HALF_YEARLY' as const,
    durationDays: 180,
    pricePaise: 750_000,
    joiningFeePaise: 0,
    maxFreezeDays: 0,
    features: [] as string[],
    sortOrder: 5,
  },
  {
    name: 'FITNESS 12M',
    description: '12 months of gym access. One day cardio, one day weight training.',
    type: 'YEARLY' as const,
    durationDays: 365,
    pricePaise: 1_400_000,
    joiningFeePaise: 0,
    maxFreezeDays: 0,
    features: [] as string[],
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
