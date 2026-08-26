export async function getWindowSizes(app) {
  const [minWidth, minHeight] = await evaluateMainProcess(app, ({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getMinimumSize()
  )
  const { width, height } = await evaluateMainProcess(app, ({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds()
  )
  return [
    { label: 'default', width, height },
    { label: 'min', width: minWidth, height: minHeight }
  ]
}

export async function evaluateMainProcess(app, evaluator, argument) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await app.evaluate(evaluator, argument)
    } catch (error) {
      if (attempt === 1 || !isGarbageCollectedEvaluation(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  throw new Error('Electron main-process evaluation did not complete.')
}

function isGarbageCollectedEvaluation(error) {
  return error instanceof Error && error.message.includes('Resulting promise was garbage collected')
}
