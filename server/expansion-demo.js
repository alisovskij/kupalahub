/** Fictional examples; never used as a fallback for live university data. */
export function learningDemo(tab) {
  const subjects = [
    'Базы данных',
    'Теория вероятностей',
    'Алгоритмы и структуры данных',
    'Английский язык',
  ];
  const common = {
    source: 'demo',
    status: 'demo',
    connected: false,
    fictional: true,
    semester: '5 семестр',
    fetchedAt: null,
  };
  const data = {
    grades: {
      items: subjects.map((subject, i) => ({
        id: `grade-${i}`,
        subject,
        semester: '5 семестр',
        control: i === 3 ? 'Зачёт' : 'Экзамен',
        result: i === 3 ? 'Зачтено' : [8, 9, 7][i],
        date: `2026-01-${19 + i}`,
        credits: [5, 4, 6, 3][i],
      })),
      summary: {
        subjects: 4,
        passed: 4,
        average: 8,
        averageLabel: 'Среднее трёх числовых оценок в примере',
      },
    },
    attestation: {
      items: subjects.map((subject, i) => ({
        id: `attestation-${i}`,
        subject,
        semester: '5 семестр',
        period: 'Первая аттестация',
        result: i === 2 ? 'Нужна доработка' : 'Аттестован',
        note:
          i === 2
            ? 'Вымышленный пример: завершить лабораторную № 2'
            : 'Вымышленный пример результата',
      })),
      summary: { total: 4, attested: 3, attention: 1 },
    },
    absences: {
      items: [
        {
          id: 'absence-1',
          date: '2026-11-09',
          subject: 'Базы данных',
          count: 2,
          reason: 'Болезнь',
          status: 'Уважительная причина',
        },
        {
          id: 'absence-2',
          date: '2026-11-12',
          subject: 'Английский язык',
          count: 1,
          reason: 'Причина не указана',
          status: 'Требует уточнения',
        },
      ],
      summary: {
        recorded: 3,
        unit: 'учебных часа в вымышленном примере',
        note: 'Реальные единицы учёта источника не подтверждены',
      },
    },
    materials: {
      items: [
        {
          id: 'course-1',
          subject: 'Базы данных',
          title: 'Проектирование реляционных баз данных',
          type: 'Учебный курс · пример',
          description: 'Нормализация, запросы и практические задания',
          sections: ['Программа', 'Теория', 'Практика', 'Контроль знаний'],
          assignments: [
            { title: 'Лабораторная работа № 3', dueDate: '2026-11-27', status: 'Не сдано' },
          ],
        },
        {
          id: 'course-2',
          subject: 'Теория вероятностей',
          title: 'Случайные величины',
          type: 'Учебный курс · пример',
          description: 'Конспект, упражнения и вопросы для подготовки',
          sections: ['Теория', 'Практика'],
          assignments: [{ title: 'Задачи 4–8', dueDate: '2026-11-30', status: 'В работе' }],
        },
      ],
      summary: { courses: 2, assignments: 2 },
    },
    finance: {
      items: [
        {
          id: 'finance-1',
          title: 'Плата за обучение',
          kind: 'charge',
          amount: 850,
          currency: 'BYN',
          date: '2026-12-01',
          status: 'Пример начисления',
        },
        {
          id: 'finance-2',
          title: 'Поступивший платёж',
          kind: 'payment',
          amount: 450,
          currency: 'BYN',
          date: '2026-11-10',
          status: 'Пример поступления',
        },
      ],
      summary: {
        note: 'Вымышленные суммы. Состав полей закрытой системы не подтверждён; это не справка о задолженности и не сведения о стипендии.',
      },
    },
    orders: {
      items: [
        {
          id: 'order-1',
          title: 'О переводе на следующий курс',
          number: 'ДЕМО-001',
          date: '2026-08-31',
          status: 'Пример',
          description:
            'Вымышленная запись для знакомства с разделом. Официальный документ не загружен.',
        },
        {
          id: 'order-2',
          title: 'О закреплении учебных групп',
          number: 'ДЕМО-002',
          date: '2026-09-01',
          status: 'Пример',
          description: 'Не является приказом университета.',
        },
      ],
      summary: { total: 2 },
    },
  };
  return { ...common, tab, ...data[tab] };
}
export function disconnectedLearning(tab) {
  return {
    tab,
    source: null,
    status: 'disconnected',
    connected: false,
    fictional: false,
    fetchedAt: null,
    items: [],
    summary: {},
    message:
      'Источник университетских данных не подключён. Доступ через личный кабинет пока не подтверждён.',
    sourceName:
      tab === 'materials' ? 'Образовательный портал Moodle' : 'Личный кабинет ГрГУ / MyGRSU',
  };
}
