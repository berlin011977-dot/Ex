# منصة الامتحانات

منصة امتحانات خفيفة مبنية بـ `Node.js` وتعمل على الجوال والكمبيوتر.  
تدعم الآن داخل نفس الملف:

- أسئلة `اختيار متعدد`
- أسئلة `صح وخطأ`
- أسئلة `كتابية / إجابة قصيرة`

الطالب لا يبدأ الامتحان إلا بعد كتابة اسمه، والنتائج تدعم التصحيح التلقائي مع تمييز الأسئلة الكتابية التي تحتاج مراجعة يدوية.

## التشغيل المحلي

```powershell
cmd /c npm install
cmd /c npm start
```

بعد التشغيل افتح:

```text
http://localhost:3000
```

## رابط عام مؤقت

إذا أردت رابطاً عاماً سريعاً من نفس الجهاز:

```powershell
cmd /c npm run tunnel
```

هذا يعطي رابط `trycloudflare.com` مؤقتاً، ويعمل فقط طالما الجهاز والسيرفر شغالين.

## نشر ثابت على Render

المشروع أصبح مجهزاً للنشر الثابت عبر Render بملف:

[`render.yaml`](C:/Users/Berlin/Desktop/Ex/render.yaml)

وملف Docker جاهز أيضاً إذا احتجت أي منصة أخرى:

[`Dockerfile`](C:/Users/Berlin/Desktop/Ex/Dockerfile)

### خطوات النشر الثابت

1. ارفع المشروع إلى GitHub أو GitLab.
2. افتح Render وأنشئ Blueprint من ملف `render.yaml`.
3. أدخل قيمة `OWNER_PASSWORD` عند الطلب.
4. بعد أول نشر ستحصل على رابط ثابت من نوع:

```text
https://your-service-name.onrender.com
```

### ملاحظات مهمة للنشر

- Render يعطي رابط `onrender.com` ثابتاً للخدمة.
- حفظ الامتحانات مضبوط على قرص دائم عبر المتغير `DATA_DIR`.
- ملف `render.yaml` يستخدم خدمة `starter` لأن الأقراص الدائمة في Render تحتاج خدمة مدفوعة.

## كلمة مرور المالك الحالية

```text
SnEsRQWvZ4%MnkR8KGbQ
```

يمكن تغييرها من:

[`C:\Users\Berlin\Desktop\Ex\.env`](C:\Users\Berlin\Desktop\Ex\.env)

## مكان التخزين

الامتحانات تحفظ محلياً داخل:

[`C:\Users\Berlin\Desktop\Ex\data\exams.json`](C:\Users\Berlin\Desktop\Ex\data\exams.json)

وعند النشر على Render ستحفظ داخل المسار المحدد في:

[`C:\Users\Berlin\Desktop\Ex\render.yaml`](C:\Users\Berlin\Desktop\Ex\render.yaml)
