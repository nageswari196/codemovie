/* =====================================================================
   examples.js  -  the gallery of ready-made snippets
   ---------------------------------------------------------------------
   Want to add your own? Copy one block, change the text, and save.
   Every example must stay within 30 lines and use only what CodeFlix v1
   understands (numbers, strings, lists, if, for, while, def, return, print).
   Fields:
     id     - a unique short name (no spaces)
     title  - shown on the card
     tags   - small labels on the card
     blurb  - one-line description
     code   - the Python code (use \n for new lines, 4 spaces for indents)
   ===================================================================== */
window.CODEFLIX_EXAMPLES = [
  {
    id: "hello-variables",
    title: "Hello, variables",
    tags: ["variables", "print"],
    blurb: "Store values in named boxes and print them.",
    code: [
      'name = "Asha"',
      'age = 18',
      'next_year = age + 1',
      'print("Hello " + name)',
      'print("Next year you will be", next_year)'
    ].join("\n")
  },
  {
    id: "sum-list",
    title: "Sum of a list",
    tags: ["list", "for"],
    blurb: "Add up every number using a for loop.",
    code: [
      'numbers = [4, 8, 15, 16]',
      'total = 0',
      'for n in numbers:',
      '    total = total + n',
      'print("Total is", total)'
    ].join("\n")
  },
  {
    id: "even-odd",
    title: "Even or odd?",
    tags: ["if", "else"],
    blurb: "Use % (remainder) to decide which branch runs.",
    code: [
      'number = 7',
      'if number % 2 == 0:',
      '    print(number, "is even")',
      'else:',
      '    print(number, "is odd")'
    ].join("\n")
  },
  {
    id: "countdown",
    title: "Countdown",
    tags: ["while"],
    blurb: "A while loop that counts down to liftoff.",
    code: [
      'count = 5',
      'while count > 0:',
      '    print(count)',
      '    count = count - 1',
      'print("Liftoff!")'
    ].join("\n")
  },
  {
    id: "factorial-loop",
    title: "Factorial (loop)",
    tags: ["for", "range"],
    blurb: "Multiply 1 x 2 x 3 x 4 x 5 step by step.",
    code: [
      'n = 5',
      'result = 1',
      'for i in range(1, n + 1):',
      '    result = result * i',
      'print("Factorial is", result)'
    ].join("\n")
  },
  {
    id: "factorial-recursion",
    title: "Factorial (recursion)",
    tags: ["def", "return", "call stack"],
    blurb: "Watch a function call itself and the call stack grow.",
    code: [
      'def factorial(n):',
      '    if n == 1:',
      '        return 1',
      '    return n * factorial(n - 1)',
      '',
      'answer = factorial(4)',
      'print(answer)'
    ].join("\n")
  },
  {
    id: "fibonacci-loop",
    title: "Fibonacci (loop)",
    tags: ["for", "swap"],
    blurb: "Each number is the sum of the two before it.",
    code: [
      'a = 0',
      'b = 1',
      'for i in range(7):',
      '    print(a)',
      '    a, b = b, a + b'
    ].join("\n")
  },
  {
    id: "fibonacci-recursion",
    title: "Fibonacci (recursion)",
    tags: ["def", "call stack"],
    blurb: "A function that calls itself twice - the stack goes up and down.",
    code: [
      'def fib(n):',
      '    if n < 2:',
      '        return n',
      '    return fib(n - 1) + fib(n - 2)',
      '',
      'print(fib(5))'
    ].join("\n")
  },
  {
    id: "find-max",
    title: "Find the biggest",
    tags: ["list", "if"],
    blurb: "Keep the best score seen so far.",
    code: [
      'scores = [62, 91, 45, 78]',
      'best = scores[0]',
      'for s in scores:',
      '    if s > best:',
      '        best = s',
      'print("Highest score:", best)'
    ].join("\n")
  },
  {
    id: "linear-search",
    title: "Linear search",
    tags: ["list", "break"],
    blurb: "Look at items one by one until the target is found.",
    code: [
      'items = [9, 4, 7, 2, 5]',
      'target = 7',
      'found = -1',
      'for i in range(len(items)):',
      '    if items[i] == target:',
      '        found = i',
      '        break',
      'print("Found at index", found)'
    ].join("\n")
  },
  {
    id: "binary-search",
    title: "Binary search",
    tags: ["while", "list"],
    blurb: "Halve the search area every step.",
    code: [
      'data = [2, 5, 8, 12, 16, 23, 38]',
      'target = 23',
      'low = 0',
      'high = len(data) - 1',
      'while low <= high:',
      '    mid = (low + high) // 2',
      '    if data[mid] == target:',
      '        print("Found at", mid)',
      '        break',
      '    elif data[mid] < target:',
      '        low = mid + 1',
      '    else:',
      '        high = mid - 1'
    ].join("\n")
  },
  {
    id: "bubble-sort",
    title: "Bubble sort",
    tags: ["list", "nested loops"],
    blurb: "Swap neighbours until the list is in order.",
    code: [
      'nums = [5, 2, 9, 1, 6]',
      'n = len(nums)',
      'for i in range(n - 1):',
      '    for j in range(n - 1 - i):',
      '        if nums[j] > nums[j + 1]:',
      '            nums[j], nums[j + 1] = nums[j + 1], nums[j]',
      'print(nums)'
    ].join("\n")
  },
  {
    id: "reverse-string",
    title: "Reverse a string",
    tags: ["string", "for"],
    blurb: "Build the reversed word one letter at a time.",
    code: [
      'word = "python"',
      'reversed_word = ""',
      'for ch in word:',
      '    reversed_word = ch + reversed_word',
      'print(reversed_word)'
    ].join("\n")
  },
  {
    id: "palindrome",
    title: "Palindrome check",
    tags: ["def", "while", "string"],
    blurb: "Compare letters from both ends towards the middle.",
    code: [
      'def is_palindrome(text):',
      '    left = 0',
      '    right = len(text) - 1',
      '    while left < right:',
      '        if text[left] != text[right]:',
      '            return False',
      '        left = left + 1',
      '        right = right - 1',
      '    return True',
      '',
      'print(is_palindrome("level"))',
      'print(is_palindrome("hello"))'
    ].join("\n")
  },
  {
    id: "prime-check",
    title: "Prime numbers",
    tags: ["def", "for", "return"],
    blurb: "A function that tests numbers 2 to 7 for primes.",
    code: [
      'def is_prime(n):',
      '    if n < 2:',
      '        return False',
      '    for i in range(2, n):',
      '        if n % i == 0:',
      '            return False',
      '    return True',
      '',
      'for num in range(2, 8):',
      '    print(num, is_prime(num))'
    ].join("\n")
  }
];
