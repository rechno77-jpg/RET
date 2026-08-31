export default function HomePage() {
  return (
    <main>
      <div className="container">
        <nav className="nav">
          <div className="brand">
            <div className="brand-mark">R</div>
            <div className="logo">RE<span>CHNO</span></div>
          </div>
          <div className="nav-links">
            <a href="#how">نحوه کار</a>
            <a href="#daily">سود روزانه</a>
            <a href="#referral">دعوت دوستان</a>
            <a href="#faq">سوالات</a>
          </div>
          <div className="nav-actions">
            <a className="btn btn-ghost" href="/dashboard">ورود</a>
            <a className="btn btn-primary" href="/dashboard">شروع سرمایه‌گذاری</a>
          </div>
        </nav>

        <section className="hero">
          <div>
            <div className="kicker">نسل جدید مدیریت سرمایه دیجیتال</div>
            <h1>سرمایه‌گذاری شفاف، روزانه و <span className="accent">قابل کنترل</span></h1>
            <p>
              RECHNO برای مدیریت ساده سرمایه طراحی شده؛ کاربر سرمایه‌اش را ثبت می‌کند،
              سود روزانه را دریافت می‌کند، کیف پولش را مدیریت می‌کند و هر زمان خواست
              درخواست برداشت اصل سرمایه یا سود را ثبت می‌کند.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="/dashboard">مشاهده داشبورد</a>
              <a className="btn btn-ghost" href="#how">آشنایی با سازوکار</a>
            </div>
            <div className="trust-row">
              <span>گزارش شفاف تراکنش‌ها</span>
              <span>برداشت قابل پیگیری</span>
              <span>پاداش دعوت یک‌سطحی</span>
            </div>
          </div>

          <div className="hero-visual">
            <div className="hero-top">
              <div>
                <div className="metric-label">نمونه سرمایه فعال</div>
                <div className="metric-main">۱۰٬۰۰۰٬۰۰۰ <small>تومان</small></div>
              </div>
              <div className="status-pill">سرمایه‌گذاری فعال</div>
            </div>
            <div className="mini-grid">
              <div className="mini-card"><span className="metric-label">سود امروز</span><b className="green">+۱۶٬۶۶۶</b></div>
              <div className="mini-card"><span className="metric-label">نرخ ماهانه</span><b>۵٪</b></div>
              <div className="mini-card"><span className="metric-label">حداقل ورود</span><b>۵۰ هزار</b></div>
            </div>
          </div>
        </section>

        <section className="section" id="how">
          <div className="section-head">
            <div>
              <h2 className="section-title">ساده، شفاف و قابل فهم</h2>
              <p className="section-sub">روند کار را طوری طراحی کردم که کاربر همیشه بداند سرمایه، سود و برداشت در چه وضعیتی است.</p>
            </div>
          </div>
          <div className="grid-3">
            <div className="feature"><div className="feature-icon">01</div><h3>ثبت سرمایه</h3><p>کاربر از حداقل ۵۰ هزار تومان، مبلغ دلخواه را ثبت می‌کند و سرمایه فعال در داشبورد نمایش داده می‌شود.</p></div>
            <div className="feature"><div className="feature-icon">02</div><h3>دریافت روزانه سود</h3><p>هر روز با ورود به پنل، سود همان روز را دریافت می‌کند و مبلغ مستقیماً به کیف پول اضافه می‌شود.</p></div>
            <div className="feature"><div className="feature-icon">03</div><h3>برداشت و تسویه</h3><p>سود و اصل سرمایه به‌صورت جداگانه قابل درخواست برداشت هستند و وضعیت هر درخواست قابل پیگیری است.</p></div>
          </div>
        </section>

        <section className="section" id="daily">
          <div className="highlight">
            <div className="highlight-card">
              <div className="metric-label">مدل سود فعلی</div>
              <div className="highlight-number">۵٪ <small style={{fontSize:16,color:"#8fa1b9"}}>ماهانه</small></div>
              <p>در نسخه فعلی، سود ماهانه با مبنای ۳۰ روز به سود روزانه تبدیل می‌شود و کاربر برای دریافت آن باید روزانه وارد پنل شود.</p>
            </div>
            <div className="highlight-card">
              <div className="metric-label">مثال</div>
              <div className="highlight-number">۱٬۶۶۶ <small style={{fontSize:16,color:"#8fa1b9"}}>تومان</small></div>
              <p>برای سرمایه ۱٬۰۰۰٬۰۰۰ تومان، سود روزانه تقریبی ۱٬۶۶۶ تومان خواهد بود.</p>
            </div>
          </div>
        </section>

        <section className="section" id="referral">
          <div className="ref-box">
            <div>
              <div className="kicker">دعوت دوستان</div>
              <h2 className="section-title" style={{marginTop:14}}>پاداش معرفی، بدون کم شدن سود دوست</h2>
              <p className="section-sub">هر کاربر یک کد دعوت اختصاصی دارد. اگر دوستش مستقیم با آن کد عضو شود، معرف معادل ۲٪ از سود روزانه دریافتی دوست را به‌عنوان پاداش جداگانه دریافت می‌کند.</p>
            </div>
            <div>
              <div className="ref-code">RECHNO-AB12CD</div>
              <p className="section-sub" style={{textAlign:"center"}}>نمونه کد دعوت اختصاصی</p>
            </div>
          </div>
        </section>

        <section className="section" id="faq">
          <h2 className="section-title">سوالات مهم</h2>
          <div className="faq" style={{marginTop:18}}>
            <div className="faq-item"><b>حداقل سرمایه‌گذاری چقدر است؟</b><span>۵۰٬۰۰۰ تومان.</span></div>
            <div className="faq-item"><b>سود روزانه چطور دریافت می‌شود؟</b><span>کاربر روزی یک‌بار وارد پنل می‌شود و با زدن دکمه «دریافت سود امروز» مبلغ همان روز را به کیف پول اضافه می‌کند.</span></div>
            <div className="faq-item"><b>اصل سرمایه قابل برداشت است؟</b><span>بله؛ کاربر می‌تواند برای کل یا بخشی از اصل سرمایه درخواست برداشت ثبت کند.</span></div>
            <div className="faq-item"><b>پاداش دعوت چندسطحی است؟</b><span>خیر؛ در این طراحی فقط دعوت مستقیم و یک‌سطحی وجود دارد.</span></div>
          </div>
          <div className="notice" style={{marginTop:18}}>
            برای راه‌اندازی عمومی، دریافت واقعی وجه یا تبدیل این مدل به دارایی/توکن دیجیتال، ساختار حقوقی، قراردادها، مجوزها، احراز هویت و ریسک‌های مالی باید پیش از انتشار نهایی بررسی و با محصول هماهنگ شوند.
          </div>
        </section>

        <footer className="footer">
          <div className="footer-grid">
            <div><div className="logo">RE<span>CHNO</span></div><p className="section-sub">زیرساخت مدیریت سرمایه با قابلیت توسعه به محصولات مالی و دارایی دیجیتال.</p></div>
            <div><h4>محصول</h4><p className="section-sub">داشبورد سرمایه<br/>کیف پول<br/>دعوت دوستان</p></div>
            <div><h4>شفافیت</h4><p className="section-sub">قوانین<br/>سوالات متداول<br/>گزارش تراکنش‌ها</p></div>
          </div>
          <div style={{marginTop:24}}>© RECHNO — All rights reserved.</div>
        </footer>
      </div>
    </main>
  );
}
