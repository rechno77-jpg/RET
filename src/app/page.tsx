import Link from "next/link";

export default function Home() {
  return (
    <main className="home" dir="rtl">
      <header className="nav">
        <div className="logo">RECHNO</div>

        <nav>
          <a href="#how">نحوه کار</a>
          <a href="#profit">سود سرمایه‌گذاری</a>
          <a href="#faq">سوالات متداول</a>
        </nav>

        <Link className="loginBtn" href="/dashboard">
          ورود به پنل
        </Link>
      </header>

      <section className="hero">
        <div className="glow glow1" />
        <div className="glow glow2" />

        <div className="heroContent">
          <div className="badge">سرمایه‌گذاری با RECHNO</div>

          <h1>
            سرمایه‌ات رو فعال کن،
            <br />
            <span>هر روز سودت رو دریافت کن.</span>
          </h1>

          <p>
            با حداقل ۵۰٬۰۰۰ تومان سرمایه‌گذاری کن، وضعیت سرمایه و سود
            روزانه‌ات را از پنل شخصی مدیریت کن.
          </p>

          <div className="heroButtons">
            <Link className="primaryBtn" href="/dashboard">
              شروع سرمایه‌گذاری
            </Link>

            <a className="secondaryBtn" href="#how">
              بیشتر بدانید
            </a>
          </div>

          <div className="miniStats">
            <div>
              <strong>۵٪</strong>
              <span>نرخ ماهانه</span>
            </div>

            <div>
              <strong>۵۰ هزار</strong>
              <span>حداقل سرمایه</span>
            </div>

            <div>
              <strong>روزانه</strong>
              <span>دریافت سود</span>
            </div>
          </div>
        </div>

        <div className="previewCard">
          <div className="cardTop">
            <span>سرمایه فعال</span>
            <span className="active">● فعال</span>
          </div>

          <h2>۱٬۰۰۰٬۰۰۰ تومان</h2>

          <div className="profitBox">
            <span>سود قابل دریافت امروز</span>
            <strong>۱٬۶۶۶ تومان</strong>
          </div>

          <button>دریافت سود امروز</button>

          <div className="cardBottom">
            <span>سود ماهانه</span>
            <strong>۵٪</strong>
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <div className="sectionTitle">
          <span>ساده و شفاف</span>
          <h2>سرمایه‌گذاری در ۴ مرحله</h2>
        </div>

        <div className="steps">
          <div className="step">
            <b>01</b>
            <h3>ساخت حساب</h3>
            <p>حساب کاربری خودت را ایجاد کن.</p>
          </div>

          <div className="step">
            <b>02</b>
            <h3>افزایش سرمایه</h3>
            <p>مبلغ موردنظر را برای سرمایه‌گذاری ثبت کن.</p>
          </div>

          <div className="step">
            <b>03</b>
            <h3>دریافت سود روزانه</h3>
            <p>هر روز وارد پنل شو و سود همان روز را دریافت کن.</p>
          </div>

          <div className="step">
            <b>04</b>
            <h3>برداشت</h3>
            <p>درخواست برداشت سود یا اصل سرمایه را ثبت کن.</p>
          </div>
        </div>
      </section>

      <section className="profitSection" id="profit">
        <div>
          <span className="smallTitle">مدیریت سرمایه</span>
          <h2>همه‌چیز داخل یک پنل</h2>
          <p>
            سرمایه فعال، سود روزانه، موجودی کیف پول، درخواست‌های برداشت
            و پاداش دعوت دوستان را یکجا مشاهده کن.
          </p>
        </div>

        <div className="rateCard">
          <span>نرخ محاسباتی ماهانه</span>
          <strong>۵٪</strong>
          <small>محاسبه سود روزانه بر اساس شرایط سامانه</small>
        </div>
      </section>

      <section className="referral">
        <div className="refIcon">↗</div>

        <div>
          <span>دعوت دوستان</span>
          <h2>از فعالیت دوستانت پاداش بگیر</h2>
          <p>
            با کد دعوت اختصاصی خودت دوستانت را معرفی کن و معادل ۲٪ از
            سود روزانه دریافت‌شده آن‌ها، پاداش بگیر.
          </p>
        </div>

        <Link href="/dashboard">مشاهده کد دعوت</Link>
      </section>

      <section className="faq" id="faq">
        <div className="sectionTitle">
          <span>پاسخ سریع</span>
          <h2>سوالات متداول</h2>
        </div>

        <details>
          <summary>حداقل مبلغ سرمایه‌گذاری چقدر است؟</summary>
          <p>حداقل مبلغ ثبت سرمایه ۵۰٬۰۰۰ تومان در نظر گرفته شده است.</p>
        </details>

        <details>
          <summary>سود روزانه چگونه دریافت می‌شود؟</summary>
          <p>
            کاربر باید در روز موردنظر وارد پنل شود و گزینه دریافت سود
            همان روز را انتخاب کند.
          </p>
        </details>

        <details>
          <summary>امکان برداشت اصل سرمایه وجود دارد؟</summary>
          <p>
            درخواست برداشت کامل یا بخشی از اصل سرمایه از طریق پنل ثبت
            می‌شود و وضعیت آن قابل پیگیری است.
          </p>
        </details>
      </section>

      <footer>
        <div className="logo">RECHNO</div>
        <p>سامانه مدیریت سرمایه RECHNO</p>
        <small>
          اطلاعات این نسخه جهت نمایش ساختار سامانه است و شرایط نهایی
          خدمات باید در قوانین و قراردادهای سامانه مشخص شود.
        </small>
      </footer>
    </main>
  );
}
