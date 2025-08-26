// Travel Planner script

document.addEventListener('DOMContentLoaded', () => {
  const step1 = document.getElementById('step1');
  const step2 = document.getElementById('step2');
  const step3 = document.getElementById('step3');

  const form = document.getElementById('trip-form');
  const activityContainer = document.getElementById('activity-options');
  const activitiesListDiv = document.getElementById('activities-list');
  const itineraryDiv = document.getElementById('itinerary');
  const itineraryInfoDiv = document.getElementById('itinerary-info');

  let activitiesData = [];
  let chabadData = [];
  let selectedActivities = [];
  let itinerary = [];
  let holidays = [];
  let shabbatDates = [];

  // Load activities and chabad data
  fetch('data/activities.json')
    .then(response => response.json())
    .then(data => {
      activitiesData = data;
    });
  fetch('data/chabad.json')
    .then(response => response.json())
    .then(data => {
      chabadData = data;
    });

  // Step 1 submission
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const startDate = formData.get('start-date');
    const endDate = formData.get('end-date');
    const destination = formData.get('destination').trim();
    const activityPrefs = formData.getAll('preferences');
    const kosher = formData.get('kosher');
    const travelers = formData.get('travelers');
    const occasion = formData.get('occasion');

    if (!startDate || !endDate || !destination) {
      alert('Please fill in start date, end date and destination.');
      return;
    }

    // Compute holidays and shabbat
    computeShabbatAndHolidays(startDate, endDate, destination).then(result => {
      holidays = result.holidays;
      shabbatDates = result.shabbat;
      // Filter activities for destination and preferences
      const filtered = filterActivities(destination, activityPrefs);
      // Render activity options
      renderActivities(filtered);

      // Show Step2
      step1.classList.remove('active');
      step2.classList.add('active');

      // Save the inputs for itinerary generation later
      step2.dataset.startDate = startDate;
      step2.dataset.endDate = endDate;
      step2.dataset.destination = destination;
      step2.dataset.kosher = kosher;
      step2.dataset.travelers = travelers;
      step2.dataset.occasion = occasion;
    });
  });

  // Filter activities based on destination and preferences
  function filterActivities(destination, prefs) {
    // For simplicity, return all activities for the destination (Vietnam) and filter by preferences categories
    const results = activitiesData.filter(act => {
      const matchDest = true; // Extend for multiple destinations later
      const matchPref = prefs.length === 0 || prefs.some(pref => act.categories.includes(pref));
      return matchDest && matchPref;
    });
    return results;
  }

  // Render list of activities with checkboxes
  function renderActivities(list) {
    activitiesListDiv.innerHTML = '';
    list.forEach(act => {
      const div = document.createElement('div');
      div.className = 'activity-item';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = act.id;
      checkbox.value = act.id;
      const label = document.createElement('label');
      label.htmlFor = act.id;
      label.innerHTML = `<strong>${act.name}</strong><br><small>${act.description}</small>`;
      div.appendChild(checkbox);
      div.appendChild(label);
      activitiesListDiv.appendChild(div);
    });
  }

  // Step 2 submission (select activities)
  const activitiesForm = document.getElementById('activities-form');
  activitiesForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const checked = activitiesListDiv.querySelectorAll('input[type="checkbox"]:checked');
    if (checked.length === 0) {
      alert('Please select at least one activity.');
      return;
    }
    selectedActivities = Array.from(checked).map(cb => {
      return activitiesData.find(act => act.id === cb.value);
    });
    // Create itinerary
    const startDate = new Date(step2.dataset.startDate);
    const endDate = new Date(step2.dataset.endDate);
    itinerary = createItinerary(selectedActivities, startDate, endDate);

    // Render itinerary and info
    renderItinerary();
    renderItineraryInfo(step2.dataset.destination);

    // Show Step3
    step2.classList.remove('active');
    step3.classList.add('active');
  });

  // Compute Shabbat (Saturday) and attempt to fetch holidays
  async function computeShabbatAndHolidays(start, end, destination) {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const shabbat = [];
    const holidaysList = [];
    // Compute Shabbat (Friday/Saturday) for range
    const current = new Date(startDate);
    while (current <= endDate) {
      const day = current.getDay();
      // Mark Friday (5) and Saturday (6) for caution
      if (day === 5 || day === 6) {
        shabbat.push(formatDate(current));
      }
      current.setDate(current.getDate() + 1);
    }

    // Fetch holidays from Hebcal
    let fetchSucceeded = false;
    try {
      const url = `https://www.hebcal.com/hebcal/?v=1&cfg=json&maj=on&min=on&mod=on&start=${start}&end=${end}&geo=none`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if (data && data.items) {
          data.items.forEach(item => {
            if (item.category === 'holiday') {
              holidaysList.push({ date: item.date, title: item.title });
            }
          });
        }
        fetchSucceeded = true;
      }
    } catch (err) {
      console.warn('Hebcal fetch failed:', err);
    }
    // If fetch failed or returned no holidays, fallback to local dataset
    if (!fetchSucceeded || holidaysList.length === 0) {
      try {
        const res = await fetch('data/holidays.json');
        const localData = await res.json();
        // Filter holidays within range
        const startDateStr = start;
        const endDateStr = end;
        localData.forEach(h => {
          if (h.start >= startDateStr && h.start <= endDateStr) {
            // Add each day of the holiday as separate entries so itinerary marks each date
            const hStart = new Date(h.start);
            const hEnd = new Date(h.end);
            for (let d = new Date(hStart); d <= hEnd; d.setDate(d.getDate() + 1)) {
              holidaysList.push({ date: formatDate(d), title: h.name });
            }
          }
        });
      } catch (error) {
        console.warn('Failed to load local holidays:', error);
      }
    }
    return { shabbat, holidays: holidaysList };
  }

  // Create itinerary by allocating activities across days, skipping Shabbat and holidays
  function createItinerary(acts, startDate, endDate) {
    const itineraryArr = [];
    let dayCounter = 0;
    const totalDays = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    // Flatten list of available dates excluding Shabbat/holiday days for heavy activities
    const dates = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const dateStr = formatDate(d);
      dates.push({ date: dateStr, isShabbat: shabbatDates.includes(dateStr), isHoliday: holidays.some(h => h.date === dateStr) });
    }

    // Allocate activities sequentially to non-Shabbat days
    let actIndex = 0;
    dates.forEach((d, idx) => {
      const dayObj = { date: d.date, activities: [], isShabbat: d.isShabbat, isHoliday: d.isHoliday };
      // If Shabbat/holiday: do not assign any of the selected activities
      if (d.isShabbat || d.isHoliday) {
        // note: we can still assign a light "Rest/Shabbat" placeholder
      } else {
        // assign up to 2 activities per day
        for (let j = 0; j < 2 && actIndex < acts.length; j++) {
          dayObj.activities.push(JSON.parse(JSON.stringify(acts[actIndex])));
          actIndex++;
        }
      }
      itineraryArr.push(dayObj);
    });
    // If there are remaining activities, append to the last non-Shabbat day
    while (actIndex < acts.length) {
      // find last non-Shabbat day
      const lastNonShabbat = itineraryArr.slice().reverse().find(day => !day.isShabbat && !day.isHoliday);
      if (lastNonShabbat) {
        lastNonShabbat.activities.push(JSON.parse(JSON.stringify(acts[actIndex])));
      }
      actIndex++;
    }
    return itineraryArr;
  }

  function renderItineraryInfo(destination) {
    // Find chabad centers for destination
    const destChabad = chabadData.find(c => c.country.toLowerCase() === destination.toLowerCase());
    let html = '';
    if (destChabad) {
      html += '<h3>Chabad Centres Near Your Destination</h3>';
      destChabad.centers.forEach(c => {
        html += `<p><strong>${c.name}</strong> – ${c.city}<br>${c.address}<br><small>${c.notes}</small></p>`;
      });
    }
    // List holidays
    if (holidays.length > 0) {
      html += '<h3>Jewish Holidays During Your Trip</h3>';
      holidays.forEach(h => {
        html += `<p>${h.date}: ${h.title}</p>`;
      });
    }
    itineraryInfoDiv.innerHTML = html;
  }

  // Render itinerary with reordering capabilities
  function renderItinerary() {
    itineraryDiv.innerHTML = '';
    itinerary.forEach((day, dayIndex) => {
      const dayDiv = document.createElement('div');
      dayDiv.className = 'itinerary-day';
      if (day.isShabbat || day.isHoliday) dayDiv.classList.add('shabbat');
      const title = document.createElement('div');
      title.className = 'day-title';
      let note = '';
      if (day.isHoliday) {
        const holidayName = holidays.find(h => h.date === day.date)?.title || 'Holiday';
        note = ` – ${holidayName} (No travel)`;
      } else if (day.isShabbat) {
        note = ' – Shabbat (No travel)';
      }
      title.textContent = `${day.date}${note}`;
      dayDiv.appendChild(title);
      // Activities list
      day.activities.forEach((act, actIndex) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'itinerary-item';
        const itemLabel = document.createElement('span');
        itemLabel.textContent = act.name;
        const reorderDiv = document.createElement('div');
        reorderDiv.className = 'reorder-buttons';
        // move up
        const upBtn = document.createElement('button');
        upBtn.textContent = '↑';
        upBtn.disabled = actIndex === 0;
        upBtn.addEventListener('click', () => moveActivity(dayIndex, actIndex, -1));
        // move down
        const downBtn = document.createElement('button');
        downBtn.textContent = '↓';
        downBtn.disabled = actIndex === day.activities.length - 1;
        downBtn.addEventListener('click', () => moveActivity(dayIndex, actIndex, 1));
        // move to previous day
        const leftBtn = document.createElement('button');
        leftBtn.textContent = '←';
        leftBtn.disabled = dayIndex === 0;
        leftBtn.addEventListener('click', () => moveActivityToAnotherDay(dayIndex, actIndex, dayIndex - 1));
        // move to next day
        const rightBtn = document.createElement('button');
        rightBtn.textContent = '→';
        rightBtn.disabled = dayIndex === itinerary.length - 1;
        rightBtn.addEventListener('click', () => moveActivityToAnotherDay(dayIndex, actIndex, dayIndex + 1));

        reorderDiv.appendChild(upBtn);
        reorderDiv.appendChild(downBtn);
        reorderDiv.appendChild(leftBtn);
        reorderDiv.appendChild(rightBtn);
        itemDiv.appendChild(itemLabel);
        itemDiv.appendChild(reorderDiv);
        dayDiv.appendChild(itemDiv);
      });
      // If Shabbat/Holiday, show rest note
      if (day.isShabbat || day.isHoliday) {
        const noteDiv = document.createElement('div');
        noteDiv.className = 'notes';
        noteDiv.textContent = 'Rest and synagogue attendance day';
        dayDiv.appendChild(noteDiv);
      }
      itineraryDiv.appendChild(dayDiv);
    });
  }

  // Move activity up or down within the same day
  function moveActivity(dayIndex, actIndex, offset) {
    const activities = itinerary[dayIndex].activities;
    const newIndex = actIndex + offset;
    if (newIndex >= 0 && newIndex < activities.length) {
      const tmp = activities[actIndex];
      activities[actIndex] = activities[newIndex];
      activities[newIndex] = tmp;
      renderItinerary();
    }
  }

  // Move activity to a different day
  function moveActivityToAnotherDay(fromDay, actIndex, toDay) {
    if (toDay < 0 || toDay >= itinerary.length) return;
    const activity = itinerary[fromDay].activities.splice(actIndex, 1)[0];
    itinerary[toDay].activities.push(activity);
    renderItinerary();
  }

  // Utility to format date as YYYY-MM-DD
  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
});
